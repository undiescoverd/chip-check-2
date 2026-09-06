import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/{slug}` → `/{slug}/display` (§21).
 *
 * The layout has already resolved the slug by the time this runs, so an unknown shop is
 * a 404 rather than a redirect into one.
 */
export default function SlugIndexPage({ params }: { params: { slug: string } }) {
  redirect(`/${params.slug}/display`);
}
