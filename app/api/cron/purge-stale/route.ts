import { NextResponse } from "next/server";
import { requireCron } from "@/lib/server/auth";
import { apiHandler } from "@/lib/server/errors";
import { purgeAll } from "@/lib/server/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stale-order sweep (§13.1). Scheduled in `vercel.ts`.
 *
 * GET, not POST: Vercel invokes cron jobs with GET and an
 * `Authorization: Bearer <CRON_SECRET>` header. Anything without that header is refused
 * — the route is publicly routable, so the bearer is the only thing protecting it.
 */
export const GET = apiHandler<unknown>(async (req) => {
  requireCron(req);
  return NextResponse.json(await purgeAll());
});
