import { z } from "zod";

/**
 * Fail-closed server configuration (§7.3, §26).
 *
 * v1's headline defect was an auth check that passed when its env var was unset
 * (`undefined === undefined`). Every required server secret is validated here, and a
 * missing one throws — so a misconfigured deployment returns 500 rather than silently
 * opening the write path.
 *
 * DEVIATION from §7.3: the parse is lazy and memoised rather than run at module load.
 * A module-load throw would fail `next build` in any environment without runtime
 * secrets — including CI, which is a Phase 0 Definition of Done item. Calling
 * `serverEnv()` at the top of every handler gives the identical fail-closed guarantee
 * and makes the behaviour unit-testable. Recorded in PROGRESS.md.
 */

const BooleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v.toLowerCase() === "true"));

const ServerEnvSchema = z
  .object({
    // Firebase — server only
    FIREBASE_SERVICE_ACCOUNT_JSON: z
      .string()
      .min(1, "FIREBASE_SERVICE_ACCOUNT_JSON is required (base64 service-account JSON)"),

    // App secrets — server only
    STAFF_SESSION_SECRET: z
      .string()
      .min(32, "STAFF_SESSION_SECRET must be at least 32 characters"),
    CRON_SECRET: z.string().min(1, "CRON_SECRET is required"),
    SUPERADMIN_UIDS: z.string().optional().default(""),

    // Billing — feature-flagged (§17)
    BILLING_ENABLED: BooleanFromString.optional().default(false),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_ID: z.string().optional(),

    // Site
    NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
    NEXT_PUBLIC_DEMO_SLUG: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    // Stripe vars are required only when billing is on (§7.3).
    if (!v.BILLING_ENABLED) return;
    for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"] as const) {
      if (!v[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when BILLING_ENABLED is true`,
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

/** Pure parser — exported so the fail-closed behaviour can be unit-tested. */
export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    // Names only — never the values.
    throw new Error(`Invalid server environment: ${detail}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Memoised accessor. Throws on any invalid/missing required secret. */
export function serverEnv(): ServerEnv {
  if (!cached) cached = parseServerEnv(process.env);
  return cached;
}

/** Test seam only. */
export function resetServerEnvCache(): void {
  cached = undefined;
}

export function superadminUids(): string[] {
  return serverEnv()
    .SUPERADMIN_UIDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
