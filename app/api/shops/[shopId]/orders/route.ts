import { NextResponse } from "next/server";
import { OrdersBody } from "@/lib/schemas/orders";
import { requireStaff } from "@/lib/server/auth";
import { apiHandler } from "@/lib/server/errors";
import { clientIp, parseBody } from "@/lib/server/http";
import { addOrder, clear, clearAll, markReady, recall, unclear } from "@/lib/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: { shopId: string };
}

/**
 * The orders write path (§13). Every action for a shop goes through this one endpoint,
 * discriminated by `action`, because the staff console only ever needs one fetch helper.
 *
 * Auth is the `cc_staff` cookie for this shop (§7.2 step 6). Phase 1's `X-Dev-Staff-Token`
 * header is gone — see `lib/server/auth.ts`.
 */
export const POST = apiHandler<Context>(async (req, { params }) => {
  const { shopId } = params;
  requireStaff(req, shopId);

  const body = await parseBody(req, OrdersBody);
  const ip = clientIp(req);

  switch (body.action) {
    case "add":
      return NextResponse.json({ order: await addOrder(shopId, body.orderNumber, ip) });

    case "markReady":
      return NextResponse.json({ order: await markReady(shopId, body.id) });

    case "recall":
      return NextResponse.json({ order: await recall(shopId, body.id) });

    case "clear":
      return NextResponse.json({ order: await clear(shopId, body.id) });

    case "unclear":
      return NextResponse.json({ order: await unclear(shopId, body.id) });

    case "clearAll": {
      const cleared = await clearAll(
        shopId,
        { status: body.status, olderThanSeconds: body.olderThanSeconds },
        ip,
      );
      return NextResponse.json({ cleared });
    }
  }
});
