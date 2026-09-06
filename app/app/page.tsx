import Link from "next/link";
import {
  Card,
  Page,
  PageTitle,
  PrimaryLink,
  SecondaryLink,
} from "@/components/owner/primitives";
import { requireOwnerPage } from "@/lib/server/pageAuth";
import { listOwnerShops } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/**
 * `/app` — the owner's shops (§22.4).
 *
 * A server component, and it has to be: `users/{uid}` is server-only in
 * `firestore.rules` (§10) and `list` on `shops` is denied so tenants cannot be
 * enumerated. The Admin SDK is the only way to answer "which shops are mine".
 */
export default async function AppPage() {
  const { uid } = await requireOwnerPage("/app");
  const shops = await listOwnerShops(uid);

  return (
    <Page>
      <PageTitle>Your shops</PageTitle>

      {shops.length === 0 ? (
        <>
          <p className="text-sm text-muted-gray">No shops yet.</p>
          <PrimaryLink href="/app/new">Create your first shop</PrimaryLink>
        </>
      ) : (
        <>
          {shops.map((shop) => (
            <Card key={shop.id}>
              <div className="flex flex-col gap-1">
                <span className="font-display text-xl font-extrabold uppercase tracking-wide">
                  {shop.name}
                </span>
                <span className="text-sm text-muted-gray">/{shop.slug}</span>
              </div>
              <div className="flex flex-col gap-3">
                <SecondaryLink href={`/${shop.slug}/display`} external>
                  Display
                </SecondaryLink>
                <SecondaryLink href={`/${shop.slug}/staff`} external>
                  Staff
                </SecondaryLink>
                <SecondaryLink href={`/${shop.slug}/qr`} external>
                  Print QR
                </SecondaryLink>
                <PrimaryLink href={`/app/${shop.slug}`}>Settings</PrimaryLink>
              </div>
            </Card>
          ))}
          <PrimaryLink href="/app/new">Create another shop</PrimaryLink>
        </>
      )}

      <Link
        href="/logout"
        className="font-display text-xs font-extrabold uppercase tracking-wider text-muted-gray text-center"
      >
        Sign out
      </Link>
    </Page>
  );
}
