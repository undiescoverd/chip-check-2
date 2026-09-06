import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { superadminUids } from "@/lib/env";
import { ApiError } from "@/lib/server/errors";
import {
  SESSION_COOKIE_NAME,
  isSuperadmin,
  requireOwnerFromCookie,
  type OwnerIdentity,
} from "@/lib/server/session";

/**
 * Page-level owner auth (§7.1 step 6).
 *
 * Route handlers take a `Request` and throw `ApiError`; pages read the cookie through
 * `next/headers` and *redirect* instead — an owner who lands on `/app` with an expired
 * cookie should be sent to sign in, not shown a JSON 401.
 */
export async function requireOwnerPage(nextPath: string): Promise<OwnerIdentity> {
  const value = cookies().get(SESSION_COOKIE_NAME)?.value;

  try {
    return await requireOwnerFromCookie(value);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    }
    throw err;
  }
}

/** Same, for `/admin` (Phase 5 builds the page; the gate belongs to Phase 2 task 1). */
export async function requireSuperadminPage(nextPath: string): Promise<OwnerIdentity> {
  const identity = await requireOwnerPage(nextPath);
  if (!isSuperadmin(identity.uid, superadminUids())) {
    throw new ApiError(403, "forbidden");
  }
  return identity;
}
