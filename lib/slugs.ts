/**
 * Slug rules (§5). Pure and isomorphic — `/app/new` uses these for instant feedback
 * before the debounced availability call, and the server re-checks on every write.
 * Nothing here touches Firestore.
 */

/**
 * §5's regex, verbatim. It is kept as the charset check rather than rewritten, because
 * the spec quotes it and it is the shape everything else is described against.
 *
 * It does NOT enforce everything §5's prose says, which is why `isValidSlug` applies
 * two more checks rather than trusting it alone:
 *
 *   - the trailing group is optional, so a single character matches — the prose says
 *     3–40. (Two characters fail, since the group needs at least two. Length is checked
 *     explicitly below instead of reasoning about that.)
 *   - `a--b` matches, but the prose forbids double hyphens.
 *
 * Recorded in PROGRESS.md rather than silently "fixing" the spec's regex.
 */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

/**
 * Slugs that can never be created (§5). These are the static routes that would
 * otherwise be shadowed — `/{slug}` sits at the root, so a shop called `login` would
 * fight the sign-in page. Next.js resolves static segments first, so the shop would
 * simply be unreachable rather than break the app; refusing the slug is how the owner
 * finds out at creation time instead of after printing a QR code.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "staff",
  "display",
  "qr",
  "api",
  "login",
  "logout",
  "app",
  "admin",
  "new",
  "settings",
  "billing",
  "about",
  "pricing",
  "help",
  "terms",
  "privacy",
  "www",
  "static",
  "_next",
  "favicon.ico",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
];

const RESERVED = new Set(RESERVED_SLUGS);

export type SlugRejection = "invalid" | "reserved";

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

export function isValidSlug(slug: string): boolean {
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) return false;
  if (slug.includes("--")) return false;
  return SLUG_PATTERN.test(slug);
}

/**
 * The two rejections a slug can carry before availability is even considered.
 * `null` means "well-formed and not reserved" — it says nothing about whether it is
 * taken, which only Firestore can answer.
 */
export function checkSlug(slug: string): SlugRejection | null {
  if (!isValidSlug(slug)) return "invalid";
  if (isReservedSlug(slug)) return "reserved";
  return null;
}

/**
 * Derive a slug from a shop name: `"Two Little Fish"` → `two-little-fish` (§5).
 * Lowercase, non-alphanumerics collapsed to single hyphens, trimmed, truncated.
 */
export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks so "Café" becomes "cafe" rather than "caf".
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return base.slice(0, SLUG_MAX_LENGTH).replace(/-$/, "");
}

/**
 * Suggest a free slug for a name (§5): try the derived slug, then `-2`, `-3`, … until
 * one is neither taken nor reserved. `isTaken` is injected so this stays pure and the
 * caller owns the Firestore reads.
 *
 * Returns `null` if the name yields nothing usable (e.g. it is all punctuation) — the
 * owner then types their own, which §5 allows anyway.
 */
export function suggestSlug(
  name: string,
  isTaken: (slug: string) => boolean,
  limit = 50,
): string | null {
  const base = slugifyName(name);
  if (!base) return null;

  // A short name can slugify below the 3-char minimum; the numeric suffix often
  // rescues it, so pad rather than giving up.
  const seed = base.length < SLUG_MIN_LENGTH ? base.padEnd(SLUG_MIN_LENGTH, "0") : base;

  for (let n = 1; n <= limit; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    // Trim the stem, not the suffix — otherwise a 40-char name yields the same
    // over-length candidate every time and the loop can never terminate.
    const stem = seed.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-$/, "");
    const candidate = `${stem}${suffix}`;

    if (isValidSlug(candidate) && !isReservedSlug(candidate) && !isTaken(candidate)) {
      return candidate;
    }
  }
  return null;
}
