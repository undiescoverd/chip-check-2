import { NextResponse } from "next/server";
import { checkSlug } from "@/lib/slugs";
import { apiHandler } from "@/lib/server/errors";
import { isSlugTaken } from "@/lib/server/shopAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: { slug: string };
}

/**
 * Slug availability for `/app/new` (§13).
 *
 * Public, and it returns nothing but `{ available, reason }` — never the shop id, name
 * or owner. `slugs/{slug}` is publicly readable anyway (§10), so this leaks nothing new;
 * the discipline is that it must not become a lookup that returns more than a boolean.
 *
 * Deliberately unauthenticated: the owner is typing into the form before the shop
 * exists. Left to Vercel's default rate limiting, per Phase 2 task 2 — it is a read of
 * one document by exact id, with no enumeration value beyond what §10 already allows.
 */
export const GET = apiHandler<Context>(async (_req, { params }) => {
  const slug = params.slug;

  const rejection = checkSlug(slug);
  if (rejection) {
    return NextResponse.json({ available: false, reason: rejection });
  }

  if (await isSlugTaken(slug)) {
    return NextResponse.json({ available: false, reason: "taken" });
  }

  return NextResponse.json({ available: true });
});
