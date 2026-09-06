import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/lib/server/admin";
import { apiHandler } from "@/lib/server/errors";
import { parseBody, readCookie } from "@/lib/server/http";
import {
  SESSION_COOKIE_NAME,
  createSession,
  sessionCookieOptions,
  verifySession,
} from "@/lib/server/session";
import { upsertUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SessionBody = z.object({ idToken: z.string().min(1) });

/**
 * Exchange a Google ID token for the `cc_session` cookie (§7.1, §13).
 *
 * The client signs out of the Firebase SDK straight after this returns — the cookie is
 * the session. Keeping both would give two sources of truth and would leave the browser
 * holding authenticated Firestore credentials the rules deliberately do not use.
 */
export const POST = apiHandler(async (req) => {
  const { idToken } = await parseBody(req, SessionBody);
  const session = await createSession(idToken);

  await upsertUser(session.uid, session.email, session.displayName);

  const res = NextResponse.json({ uid: session.uid });
  res.cookies.set(SESSION_COOKIE_NAME, session.cookie, sessionCookieOptions());
  return res;
});

/**
 * Sign out (§7.1 step 7): clear the cookie and revoke refresh tokens, so the session
 * cookie stops verifying rather than merely being dropped by this one browser.
 *
 * Best effort by design — §13 gives it no error responses. An unverifiable cookie still
 * gets cleared, because the user's intent to sign out does not depend on their cookie
 * still being valid.
 */
export const DELETE = apiHandler(async (req) => {
  const existing = readCookie(req, SESSION_COOKIE_NAME);

  if (existing) {
    try {
      const decoded = await verifySession(existing);
      await adminAuth().revokeRefreshTokens(decoded.uid);
    } catch {
      // Already invalid, or Firebase is unreachable. Clearing the cookie below is the
      // part the caller can see, and it must happen either way.
    }
  }

  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions(0), maxAge: 0 });
  return res;
});
