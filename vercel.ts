import type { VercelConfig } from "@vercel/config/v1";

// Stale-order purge (§13.1). Vercel invokes crons with GET and an
// "Authorization: Bearer ${CRON_SECRET}" header; the handler rejects anything else.
// On the Hobby plan crons are limited to once per day — if that applies, change the
// schedule to "0 4 * * *" and rely on the opportunistic purge on `add` (Part I #8).
export const config: VercelConfig = {
  framework: "nextjs",
  crons: [{ path: "/api/cron/purge-stale", schedule: "*/30 * * * *" }],
};
