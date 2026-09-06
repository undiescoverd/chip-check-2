import { NextResponse } from "next/server";
import { CreateShopBody } from "@/lib/schemas/shops";
import { apiHandler } from "@/lib/server/errors";
import { parseBody } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/session";
import { createShop } from "@/lib/server/shopAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a shop (§8, §13). One transaction over `shops/{id}`, `slugs/{slug}`,
 * `private/auth`, `private/billing` and `users/{uid}.shopIds` — see `createShop`.
 */
export const POST = apiHandler(async (req) => {
  const { uid } = await requireOwner(req);
  const body = await parseBody(req, CreateShopBody);

  const shop = await createShop(uid, body);
  return NextResponse.json({ shop }, { status: 201 });
});
