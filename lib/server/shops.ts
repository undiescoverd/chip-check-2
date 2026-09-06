import "server-only";
import { adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/errors";
import { toShop } from "@/lib/server/firestore";
import type { Shop } from "@/lib/types";

export function shopRef(shopId: string) {
  return adminDb().collection("shops").doc(shopId);
}

export function ordersRef(shopId: string) {
  return shopRef(shopId).collection("orders");
}

/** The uniqueness lock keyed by order number (§9). */
export function activeNumberRef(shopId: string, orderNumber: string) {
  return shopRef(shopId).collection("activeNumbers").doc(orderNumber);
}

export function privateRef(shopId: string, doc: string) {
  return shopRef(shopId).collection("private").doc(doc);
}

export async function getShop(shopId: string): Promise<Shop> {
  const snap = await shopRef(shopId).get();
  if (!snap.exists) throw new ApiError(404, "shop_not_found");
  return toShop(snap.id, snap.data()!);
}

/**
 * `slugs/{slug}` → shop (§5). The slug is the public capability; the id is internal.
 *
 * Server components under `/{slug}` should import `shopForSlug` from
 * `lib/server/shopPage.ts` instead — same lookup, deduped for the request.
 */
export async function getShopBySlug(slug: string): Promise<Shop> {
  const lookup = await adminDb().collection("slugs").doc(slug).get();
  if (!lookup.exists) throw new ApiError(404, "shop_not_found");

  const shopId = lookup.data()?.shopId;
  if (typeof shopId !== "string" || !shopId) throw new ApiError(404, "shop_not_found");

  return getShop(shopId);
}

export async function resolveSlug(slug: string): Promise<string> {
  const snap = await adminDb().collection("slugs").doc(slug).get();
  const shopId = snap.exists ? snap.data()?.shopId : undefined;
  if (typeof shopId !== "string" || !shopId) throw new ApiError(404, "shop_not_found");
  return shopId;
}
