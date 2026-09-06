import { getAuth } from "firebase-admin/auth";
import { beforeEach, describe, expect, it } from "vitest";
import { adminApp } from "@/lib/server/admin";
import {
  AUTH_TIME_MAX_AGE_MS,
  assertOwns,
  createSession,
  isAuthTimeFresh,
  isSuperadmin,
  requireOwner,
  requireOwnerOf,
  verifySession,
  SESSION_COOKIE_NAME,
} from "@/lib/server/session";
import { createShop } from "@/lib/server/shopAdmin";
import { upsertUser, userRef } from "@/lib/server/users";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { clearEmulator, expectApiError } from "./helpers";

/**
 * Owner sessions against the real Auth emulator (§7.1).
 *
 * §28 assumed none of this was testable in the sandbox. The Auth emulator does implement
 * `createSessionCookie` and `verifySessionCookie`, so the actual exchange is exercised
 * here rather than mocked.
 *
 * One thing it does NOT enforce: `revokeRefreshTokens` is accepted but a previously
 * issued session cookie still verifies afterwards. The revocation *call* is covered
 * below; that revocation is honoured is left to the deployed environment and recorded in
 * PROGRESS.md.
 */

const EMAIL = "owner@example.com";

function auth() {
  return getAuth(adminApp());
}

/** Mint a real ID token the way the browser SDK does, via the emulator's REST API. */
async function idTokenFor(uid: string): Promise<string> {
  const custom = await auth().createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;

  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`custom-token exchange failed: ${await res.text()}`);
  return (await res.json()).idToken;
}

async function makeUser(uid: string, email = EMAIL) {
  await auth().createUser({ uid, email, displayName: "Test Owner" });
  return idTokenFor(uid);
}

function requestWithCookie(value: string) {
  return new Request("https://example.test/api/shops/x", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${value}` },
  });
}

beforeEach(async () => {
  await clearEmulator();
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  // The Auth emulator has its own store, cleared through its own endpoint.
  await fetch(`http://${host}/emulator/v1/projects/demo-chipcheck/accounts`, {
    method: "DELETE",
  });
});

describe("isAuthTimeFresh", () => {
  const now = 1_700_000_000_000;

  it("accepts a token minted just now", () => {
    expect(isAuthTimeFresh(now / 1000, now)).toBe(true);
  });

  it("accepts one four minutes old and rejects one six minutes old", () => {
    expect(isAuthTimeFresh(now / 1000 - 4 * 60, now)).toBe(true);
    expect(isAuthTimeFresh(now / 1000 - 6 * 60, now)).toBe(false);
  });

  it("rejects at the boundary but tolerates small clock skew", () => {
    expect(isAuthTimeFresh((now - AUTH_TIME_MAX_AGE_MS - 1) / 1000, now)).toBe(false);
    // A token from slightly "in the future" is ordinary skew, not an attack.
    expect(isAuthTimeFresh((now + 30_000) / 1000, now)).toBe(true);
    expect(isAuthTimeFresh((now + 10 * 60_000) / 1000, now)).toBe(false);
  });

  it.each([undefined, null, "abc", NaN, Infinity])("rejects %s", (value) => {
    expect(isAuthTimeFresh(value, now)).toBe(false);
  });
});

describe("createSession", () => {
  it("exchanges a fresh ID token for a verifiable session cookie", async () => {
    const idToken = await makeUser("uid-1");

    const session = await createSession(idToken);
    expect(session.uid).toBe("uid-1");
    expect(session.email).toBe(EMAIL);
    expect(session.cookie).toBeTruthy();

    const decoded = await verifySession(session.cookie);
    expect(decoded.uid).toBe("uid-1");
  });

  it("refuses a garbage token with invalid_token, not a 500", async () => {
    const err = await expectApiError(createSession("not-a-token"));
    expect(err.status).toBe(401);
    expect(err.code).toBe("invalid_token");
  });

  it("refuses a token whose auth_time is stale (§7.1 step 3)", async () => {
    const idToken = await makeUser("uid-1");
    // Six minutes later, the same token is past Firebase's five-minute rule.
    const err = await expectApiError(createSession(idToken, Date.now() + 6 * 60 * 1000));
    expect(err.status).toBe(401);
    expect(err.code).toBe("invalid_token");
  });
});

describe("verifySession", () => {
  it("refuses a missing cookie", async () => {
    const err = await expectApiError(verifySession(undefined));
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthorized");
  });

  it("refuses a garbage cookie", async () => {
    const err = await expectApiError(verifySession("nonsense"));
    expect(err.status).toBe(401);
  });

  it("accepts revoking refresh tokens without error (§7.1 step 7)", async () => {
    // The call must succeed; whether the emulator then rejects the cookie is not
    // something it models — see the note at the top of this file.
    const idToken = await makeUser("uid-1");
    const session = await createSession(idToken);
    await expect(auth().revokeRefreshTokens(session.uid)).resolves.toBeUndefined();
  });
});

describe("requireOwner", () => {
  it("reads the cookie off the request", async () => {
    const idToken = await makeUser("uid-1");
    const session = await createSession(idToken);

    const identity = await requireOwner(requestWithCookie(session.cookie));
    expect(identity.uid).toBe("uid-1");
    expect(identity.email).toBe(EMAIL);
  });

  it("401s with no cookie at all", async () => {
    const err = await expectApiError(
      requireOwner(new Request("https://example.test/api/shops/x")),
    );
    expect(err.status).toBe(401);
  });
});

describe("requireOwnerOf", () => {
  it("admits the owner", async () => {
    const idToken = await makeUser("uid-1");
    const session = await createSession(idToken);
    const shop = await createShop("uid-1", {
      name: "Two Little Fish",
      slug: "two-little-fish",
      settings: DEFAULT_SETTINGS,
      pin: "4321",
    });

    const result = await requireOwnerOf(requestWithCookie(session.cookie), shop.id);
    expect(result.shop.id).toBe(shop.id);
  });

  /**
   * The Phase 2 Definition of Done: a different Google account gets 403, not 401 and not
   * a silent success. This is the tenant boundary.
   */
  it("403s a signed-in stranger", async () => {
    await makeUser("uid-1");
    const strangerToken = await makeUser("uid-2", "stranger@example.com");
    const strangerSession = await createSession(strangerToken);

    const shop = await createShop("uid-1", {
      name: "Two Little Fish",
      slug: "two-little-fish",
      settings: DEFAULT_SETTINGS,
      pin: "4321",
    });

    const err = await expectApiError(
      requireOwnerOf(requestWithCookie(strangerSession.cookie), shop.id),
    );
    expect(err.status).toBe(403);
    expect(err.code).toBe("forbidden");
  });

  it("404s on a shop that does not exist", async () => {
    const idToken = await makeUser("uid-1");
    const session = await createSession(idToken);

    const err = await expectApiError(
      requireOwnerOf(requestWithCookie(session.cookie), "no-such-shop"),
    );
    expect(err.status).toBe(404);
  });
});

describe("assertOwns and isSuperadmin", () => {
  it("separates 403 from 401 as a pure check", () => {
    const shop = { ownerUid: "uid-1" } as Parameters<typeof assertOwns>[0];
    expect(() => assertOwns(shop, "uid-1")).not.toThrow();
    expect(() => assertOwns(shop, "uid-2")).toThrow();
  });

  it("gates superadmin on the configured UID list", () => {
    expect(isSuperadmin("uid-1", ["uid-1", "uid-9"])).toBe(true);
    expect(isSuperadmin("uid-2", ["uid-1"])).toBe(false);
    // An empty list must admit nobody — fail closed.
    expect(isSuperadmin("uid-1", [])).toBe(false);
  });
});

describe("the sign-in side effect", () => {
  it("upserts users/{uid} on sign-in (§7.1 step 4)", async () => {
    const idToken = await makeUser("uid-1");
    const session = await createSession(idToken);
    await upsertUser(session.uid, session.email, session.displayName);

    const doc = await userRef("uid-1").get();
    expect(doc.data()?.email).toBe(EMAIL);
    expect(doc.data()?.displayName).toBe("Test Owner");
    expect(doc.data()?.lastLoginAt).toBeTruthy();
  });
});
