import { NextResponse } from "next/server";
import { SetPinBody } from "@/lib/schemas/shops";
import { apiHandler } from "@/lib/server/errors";
import { parseBody } from "@/lib/server/http";
import { requireOwnerOf } from "@/lib/server/session";
import { setPin } from "@/lib/server/shopAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: { shopId: string };
}

/**
 * Set or rotate the staff PIN (§13). 204 — the PIN is never echoed back, and the owner
 * never sees it again after setting it (§7.2 step 8).
 */
export const POST = apiHandler<Context>(async (req, { params }) => {
  await requireOwnerOf(req, params.shopId);
  const { pin } = await parseBody(req, SetPinBody);

  await setPin(params.shopId, pin);
  return new NextResponse(null, { status: 204 });
});
