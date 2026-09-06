import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ShopProvider } from "./ShopProvider";
import { ApiError } from "@/lib/server/errors";
import { shopForSlug } from "@/lib/server/shopPage";

export const dynamic = "force-dynamic";

/**
 * Resolves `slugs/{slug}` → shop once for every screen under `/{slug}` (§21, Phase 2
 * task 5), so the display, staff console and QR page share one lookup instead of each
 * doing their own.
 *
 * Reserved words never reach here: `/app`, `/login`, `/logout` and `/admin` are static
 * routes and Next resolves those before a dynamic segment. That is why §5's reserved
 * list exists — a shop that claimed one of those names would be shadowed and silently
 * unreachable.
 *
 * Only the public fields go to the client. `ownerUid` and everything under `private/`
 * stay on the server; the shop document is world-readable (§10), so this passes nothing
 * a visitor could not already fetch.
 */
export default async function SlugLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { slug: string };
}) {
  let shop;
  try {
    shop = await shopForSlug(params.slug);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <ShopProvider
      value={{
        shopId: shop.id,
        slug: shop.slug,
        name: shop.name,
        settings: shop.settings,
      }}
    >
      {children}
    </ShopProvider>
  );
}
