import { NewShopForm } from "./NewShopForm";
import { requireOwnerPage } from "@/lib/server/pageAuth";

export const dynamic = "force-dynamic";

/** `/app/new` (§8, §22.4). The gate is here; the form is a client component. */
export default async function NewShopPage() {
  await requireOwnerPage("/app/new");
  return <NewShopForm siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""} />;
}
