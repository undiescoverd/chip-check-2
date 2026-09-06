import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { ApiError } from "@/lib/server/errors";

/**
 * Request helpers (§14). `parseBody` is the only way a handler should read a body —
 * v1 threw an HTML 500 on malformed JSON.
 */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // zod issues are safe to return: they describe the caller's own body, not our state.
    throw new ApiError(400, "invalid_body", { issues: parsed.error.issues });
  }
  return parsed.data;
}

/**
 * Caller IP for rate limiting (§14.1): the first hop of `x-forwarded-for`, else
 * `x-real-ip`. Behind Vercel the first hop is the client; the header is attacker-
 * controlled in principle, which is why it is only ever used as a rate-limit key and
 * never as an identity.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Read one cookie from a request.
 *
 * Parsed from the header rather than `next/headers` so the auth helpers take a plain
 * `Request` and stay unit-testable outside a Next server context. Only the first
 * occurrence of a name is honoured — a second one is how a cookie-injection attempt
 * would try to shadow the real value.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;

    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/** Rate-limit keys are hashed so raw IPs are never stored (§14.1, same as `pinAttempts`). */
export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

/**
 * Constant-time string comparison.
 *
 * Digests both sides first: `timingSafeEqual` throws on length mismatch, and comparing
 * raw secrets would leak their length through that throw.
 */
export function secureEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
