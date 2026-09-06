import { notFound } from "next/navigation";
import { ShopSettings } from "./ShopSettings";
import { ApiError } from "@/lib/server/errors";
import { requireOwnerPage } from "@/lib/server/pageAuth";
import { assertOwns } from "@/lib/server/session";
import { getShopBySlug } from "@/lib/server/shops";

export const dynamic = "force-dynamic";

/**
 * `/app/{slug}` (§22.4).
 *
 * The URL carries a slug but `PATCH /api/shops/{id}` and the PIN route are keyed by
 * `shopId` (§13), so the id is resolved here and handed to the form. A non-owner gets
 * `notFound()` rather than a 403 page: the slug is public, and confirming "this shop
 * exists but isn't yours" tells a stranger more than it needs to.
 */
export default async function ShopSettingsPage({ params }: { params: { slug: string } }) {
  const { uid } = await requireOwnerPage(`/app/${params.slug}`);

  let shop;
  try {
    shop = await getShopBySlug(params.slug);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  try {
    assertOwns(shop, uid);
  } catch {
    notFound();
  }

  return <ShopSettings shop={shop} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""} />;
}
