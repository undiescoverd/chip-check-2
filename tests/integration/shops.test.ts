import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "@/lib/server/admin";
import { resetFlagsCache } from "@/lib/server/entitlement";
import { verifyPin } from "@/lib/server/pin";
import {
  PIN_MAX_ATTEMPTS,
  assertNotLockedOut,
  clearAttempts,
  recordFailedAttempt,
} from "@/lib/server/pinAttempts";
import {
  createShop,
  getPinHash,
  isSlugTaken,
  setPin,
  updateShop,
} from "@/lib/server/shopAdmin";
import { getShop, privateRef } from "@/lib/server/shops";
import { listOwnerShops, upsertUser, userRef } from "@/lib/server/users";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { clearEmulator, expectApiError } from "./helpers";

/**
 * Phase 2's write path against the real Firestore emulator.
 *
 * The risk here is the same shape as Phase 1's: a transaction that looks correct and is
 * not. Shop creation claims `slugs/{slug}` under a transaction exactly as `add` claims
 * `activeNumbers/{orderNumber}`, and the race is the assertion that matters.
 */

const UID = "uid-owner";
const OTHER_UID = "uid-someone-else";
const IP = "203.0.113.7";

function input(overrides: Partial<Parameters<typeof createShop>[1]> = {}) {
  return {
    name: "Two Little Fish",
    slug: "two-little-fish",
    settings: DEFAULT_SETTINGS,
    pin: "4321",
    ...overrides,
  };
}

beforeEach(async () => {
  await clearEmulator();
  resetFlagsCache();
});

describe("createShop", () => {
  it("writes all five documents in one transaction (§8)", async () => {
    const shop = await createShop(UID, input());

    expect(shop.name).toBe("Two Little Fish");
    expect(shop.slug).toBe("two-little-fish");
    expect(shop.ownerUid).toBe(UID);

    // The slug lookup points back at the shop.
    const slugDoc = await adminDb().collection("slugs").doc("two-little-fish").get();
    expect(slugDoc.data()?.shopId).toBe(shop.id);

    // private/auth holds a hash and nothing resembling the PIN (Phase 2 DoD).
    const auth = await privateRef(shop.id, "auth").get();
    const pinHash = auth.data()?.pinHash as string;
    expect(pinHash).toMatch(/^scrypt\$32768\$/);
    expect(pinHash).not.toContain("4321");
    expect(await verifyPin("4321", pinHash)).toBe(true);

    // private/billing starts as a pilot while the flag is off (§17).
    const billing = await privateRef(shop.id, "billing").get();
    expect(billing.data()?.status).toBe("pilot");
    expect(shop.isPilot).toBe(true);

    // The owner's user document lists it.
    const user = await userRef(UID).get();
    expect(user.data()?.shopIds).toEqual([shop.id]);
  });

  it("refuses a slug that is already taken", async () => {
    await createShop(UID, input());

    const err = await expectApiError(createShop(OTHER_UID, input()));
    expect(err.status).toBe(409);
    expect(err.code).toBe("slug_taken");
  });

  it("refuses a reserved slug before touching Firestore", async () => {
    const err = await expectApiError(createShop(UID, input({ slug: "admin" })));
    expect(err.status).toBe(400);
    expect(err.code).toBe("slug_reserved");
    expect(await isSlugTaken("admin")).toBe(false);
  });

  /**
   * The race the slug claim exists to prevent: two owners submitting the same slug at
   * once. Exactly one must win — the same assertion Phase 1 makes about `activeNumbers`,
   * and the same silent failure if the claim were a read-then-write outside a
   * transaction.
   */
  it("lets exactly one of two concurrent creates win the slug", async () => {
    const results = await Promise.allSettled([
      createShop(UID, input()),
      createShop(OTHER_UID, input()),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe("slug_taken");

    // And the loser left nothing behind: one shop holds the slug.
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value;
    const slugDoc = await adminDb().collection("slugs").doc("two-little-fish").get();
    expect(slugDoc.data()?.shopId).toBe(winner.id);
  });

  it("lets exactly one of five concurrent creates win", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createShop(UID, input())),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("gives one owner several shops, each with its own slug", async () => {
    const a = await createShop(UID, input({ slug: "shop-a" }));
    const b = await createShop(UID, input({ slug: "shop-b" }));

    const user = await userRef(UID).get();
    expect(user.data()?.shopIds).toEqual([a.id, b.id]);
  });
});

describe("updateShop", () => {
  it("updates name and settings", async () => {
    const shop = await createShop(UID, input());

    const updated = await updateShop(shop.id, {
      name: "Three Little Fish",
      settings: { ticketMinDigits: 2, ticketMaxDigits: 5 },
    });

    expect(updated.name).toBe("Three Little Fish");
    expect(updated.settings.ticketMinDigits).toBe(2);
    expect(updated.settings.ticketMaxDigits).toBe(5);
    // Untouched fields survive the partial patch.
    expect(updated.settings.readyTimeoutSeconds).toBe(300);
  });

  it("never changes the slug — printed QR codes point at it (§5)", async () => {
    const shop = await createShop(UID, input());
    const updated = await updateShop(shop.id, { name: "Renamed" });
    expect(updated.slug).toBe("two-little-fish");
  });

  it("rejects a partial patch that would break the digit rule", async () => {
    // Stored max is 4; sending only min=5 must be refused rather than stored, which is
    // why the patch is merged and revalidated as a whole.
    const shop = await createShop(UID, input());

    const err = await expectApiError(updateShop(shop.id, { settings: { ticketMinDigits: 5 } }));
    expect(err.status).toBe(400);

    const unchanged = await getShop(shop.id);
    expect(unchanged.settings.ticketMinDigits).toBe(1);
  });

  it("404s on an unknown shop", async () => {
    const err = await expectApiError(updateShop("no-such-shop", { name: "x" }));
    expect(err.status).toBe(404);
  });
});

describe("setPin", () => {
  it("rotates the hash and keeps verifying the new PIN only", async () => {
    const shop = await createShop(UID, input());
    await setPin(shop.id, "987654");

    const hash = (await getPinHash(shop.id))!;
    expect(await verifyPin("987654", hash)).toBe(true);
    expect(await verifyPin("4321", hash)).toBe(false);
  });

  it("clears the lockout — the documented way out of one (Part I risk #12)", async () => {
    const shop = await createShop(UID, input());

    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
      await recordFailedAttempt(shop.id, IP);
    }
    await expectApiError(assertNotLockedOut(shop.id, IP));

    await setPin(shop.id, "5555");

    await expect(assertNotLockedOut(shop.id, IP)).resolves.toBeUndefined();
  });

  it("404s on an unknown shop rather than creating one", async () => {
    const err = await expectApiError(setPin("no-such-shop", "1234"));
    expect(err.status).toBe(404);
    expect((await privateRef("no-such-shop", "auth").get()).exists).toBe(false);
  });
});

describe("PIN lockout (§7.2 step 3)", () => {
  it("allows five attempts and locks the sixth", async () => {
    const shop = await createShop(UID, input());

    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
      await expect(assertNotLockedOut(shop.id, IP)).resolves.toBeUndefined();
      await recordFailedAttempt(shop.id, IP);
    }

    const err = await expectApiError(assertNotLockedOut(shop.id, IP));
    expect(err.status).toBe(429);
    expect(err.code).toBe("pin_locked");
    expect(err.details?.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.details?.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("locks one IP without locking another", async () => {
    // Two tablets behind different addresses must not share a lockout.
    const shop = await createShop(UID, input());

    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
      await recordFailedAttempt(shop.id, IP);
    }

    await expectApiError(assertNotLockedOut(shop.id, IP));
    await expect(assertNotLockedOut(shop.id, "198.51.100.9")).resolves.toBeUndefined();
  });

  it("resets on a correct PIN (§7.2 step 4)", async () => {
    const shop = await createShop(UID, input());

    for (let i = 0; i < PIN_MAX_ATTEMPTS - 1; i++) {
      await recordFailedAttempt(shop.id, IP);
    }
    await clearAttempts(shop.id, IP);

    // The counter is back to zero, so five more failures are needed to lock again.
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
      await expect(assertNotLockedOut(shop.id, IP)).resolves.toBeUndefined();
      await recordFailedAttempt(shop.id, IP);
    }
    await expectApiError(assertNotLockedOut(shop.id, IP));
  });

  it("stores a hash of the IP, never the address itself", async () => {
    const shop = await createShop(UID, input());
    await recordFailedAttempt(shop.id, IP);

    const raw = JSON.stringify((await privateRef(shop.id, "pinAttempts").get()).data());
    expect(raw).not.toContain(IP);
  });

  it("expires the window rather than locking forever", async () => {
    const shop = await createShop(UID, input());

    const longAgo = Date.now() - 16 * 60 * 1000;
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
      await recordFailedAttempt(shop.id, IP, longAgo);
    }

    await expect(assertNotLockedOut(shop.id, IP)).resolves.toBeUndefined();
  });
});

describe("listOwnerShops", () => {
  it("returns only this owner's shops", async () => {
    const mine = await createShop(UID, input({ slug: "mine" }));
    await createShop(OTHER_UID, input({ slug: "theirs" }));

    const shops = await listOwnerShops(UID);
    expect(shops.map((s) => s.id)).toEqual([mine.id]);
  });

  it("is empty for a new owner", async () => {
    await upsertUser(UID, "owner@example.com", "Owner");
    expect(await listOwnerShops(UID)).toEqual([]);
  });

  it("skips an id whose shop document is gone", async () => {
    const shop = await createShop(UID, input());
    await userRef(UID).update({ shopIds: [shop.id, "deleted-shop"] });

    const shops = await listOwnerShops(UID);
    expect(shops.map((s) => s.id)).toEqual([shop.id]);
  });

  it("ignores an id belonging to another owner's shop", async () => {
    // Defence in depth: the shop document's ownerUid is the authority (§6), so a
    // tampered id list cannot surface someone else's shop.
    const theirs = await createShop(OTHER_UID, input({ slug: "theirs" }));
    await userRef(UID).set({ shopIds: [theirs.id] }, { merge: true });

    expect(await listOwnerShops(UID)).toEqual([]);
  });
});

describe("upsertUser", () => {
  it("merges rather than clobbering shopIds", async () => {
    const shop = await createShop(UID, input());
    await upsertUser(UID, "owner@example.com", "Owner");

    const user = await userRef(UID).get();
    expect(user.data()?.shopIds).toEqual([shop.id]);
    expect(user.data()?.email).toBe("owner@example.com");
  });
});
