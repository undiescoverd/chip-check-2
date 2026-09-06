import { NextResponse } from "next/server";
import { UpdateShopBody } from "@/lib/schemas/shops";
import { apiHandler } from "@/lib/server/errors";
import { parseBody } from "@/lib/server/http";
import { requireOwnerOf } from "@/lib/server/session";
import { updateShop } from "@/lib/server/shopAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: { shopId: string };
}

/**
 * Update name and settings (§13). Keyed by `shopId`, not slug — `/app/{slug}` resolves
 * the id server-side and carries it into the form.
 *
 * `requireOwnerOf` is what separates 401 from 403: not signed in is 401, signed in but
 * not this shop's owner is 403. The Phase 2 DoD tests exactly that boundary.
 */
export const PATCH = apiHandler<Context>(async (req, { params }) => {
  await requireOwnerOf(req, params.shopId);
  const body = await parseBody(req, UpdateShopBody);

  const shop = await updateShop(params.shopId, body);
  return NextResponse.json({ shop });
});
