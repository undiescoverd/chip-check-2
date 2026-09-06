import "server-only";
import { cache } from "react";
import { getShopBySlug } from "@/lib/server/shops";

/**
 * The slug → shop lookup for server components under `/{slug}`, deduplicated per request.
 *
 * Two components need it on one render of `/{slug}/staff`: the layout, which resolves the
 * shop for every screen in the segment, and the page, which needs the shop *id* to check
 * that the `cc_staff` cookie was minted for this shop and not another. Without the memo
 * that is four Firestore reads for one page load of the most-refreshed screen in the
 * product.
 *
 * It lives in its own module rather than on `getShopBySlug` itself because React's
 * `cache` exists only in the server-component build — importing it into
 * `lib/server/shops.ts` would break every route handler, script and unit test that
 * module already serves.
 */
export const shopForSlug = cache(getShopBySlug);
