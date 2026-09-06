import { describe, expect, it } from "vitest";
import {
  RESERVED_SLUGS,
  checkSlug,
  isReservedSlug,
  isValidSlug,
  slugifyName,
  suggestSlug,
} from "@/lib/slugs";

/** Slug rules (§5). Pure — no Firestore, no network. */

describe("isValidSlug", () => {
  it.each(["two-little-fish", "abc", "a1b", "shop-2", "x".repeat(40)])(
    "accepts %s",
    (slug) => {
      expect(isValidSlug(slug)).toBe(true);
    },
  );

  it.each([
    ["", "empty"],
    ["ab", "under the 3-char minimum"],
    ["a", "a single character — §5's regex accepts it, the prose does not"],
    ["x".repeat(41), "over the 40-char maximum"],
    ["-abc", "leading hyphen"],
    ["abc-", "trailing hyphen"],
    ["a--b", "double hyphen — matches §5's regex but its prose forbids it"],
    ["Abc", "uppercase"],
    ["a b", "space"],
    ["a_b", "underscore"],
    ["café", "non-ascii"],
  ])("rejects %s (%s)", (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });
});

describe("reserved slugs", () => {
  it("covers every name §5 lists", () => {
    // The list is the security-relevant part: a shop that took `api` or `_next` would
    // be shadowed by a static route and silently unreachable.
    expect(RESERVED_SLUGS).toHaveLength(23);
    for (const slug of RESERVED_SLUGS) {
      expect(isReservedSlug(slug)).toBe(true);
    }
  });

  it.each(RESERVED_SLUGS.filter((s) => isValidSlug(s)))(
    "reports %s as reserved rather than invalid",
    (slug) => {
      expect(checkSlug(slug)).toBe("reserved");
    },
  );

  it("does not reserve a name that merely contains a reserved word", () => {
    expect(isReservedSlug("app-le")).toBe(false);
    expect(checkSlug("app-le")).toBeNull();
  });

  it("reports a malformed slug as invalid, not reserved", () => {
    expect(checkSlug("A--B")).toBe("invalid");
  });
});

describe("slugifyName", () => {
  it("derives §5's worked example", () => {
    expect(slugifyName("Two Little Fish")).toBe("two-little-fish");
  });

  it.each([
    ["  Spaced  Out  ", "spaced-out"],
    ["Fish & Chips!", "fish-chips"],
    ["Café Rouge", "cafe-rouge"],
    ["Mac's Plaice", "mac-s-plaice"],
    ["---", ""],
    ["!!!", ""],
  ])("%s -> %s", (name, expected) => {
    expect(slugifyName(name)).toBe(expected);
  });

  it("never returns a trailing hyphen when truncating", () => {
    const slug = slugifyName(`${"a".repeat(39)} bcd`);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });
});

describe("suggestSlug", () => {
  const taken = (...slugs: string[]) => (s: string) => slugs.includes(s);

  it("returns the plain slug when it is free", () => {
    expect(suggestSlug("Two Little Fish", taken())).toBe("two-little-fish");
  });

  it("appends -2, -3, … until one is free (§5)", () => {
    expect(suggestSlug("Two Little Fish", taken("two-little-fish"))).toBe(
      "two-little-fish-2",
    );
    expect(
      suggestSlug("Two Little Fish", taken("two-little-fish", "two-little-fish-2")),
    ).toBe("two-little-fish-3");
  });

  it("skips a reserved slug rather than offering it", () => {
    // "Billing" derives to a reserved name; the suffixed form is not reserved.
    expect(suggestSlug("Billing", taken())).toBe("billing-2");
  });

  it("pads a name that slugifies below the minimum length", () => {
    const suggestion = suggestSlug("Al", taken());
    expect(suggestion).not.toBeNull();
    expect(isValidSlug(suggestion!)).toBe(true);
  });

  it("returns null when the name yields nothing usable", () => {
    expect(suggestSlug("!!!", taken())).toBeNull();
  });

  it("keeps the suffixed candidate within the length limit and still valid", () => {
    // A 40-char stem plus "-2" would overflow; the stem must be trimmed, not the
    // suffix, or the loop would retry the same over-length candidate forever.
    const long = "a".repeat(40);
    const suggestion = suggestSlug(long, taken(long));
    expect(suggestion).not.toBeNull();
    expect(suggestion!.length).toBeLessThanOrEqual(40);
    expect(isValidSlug(suggestion!)).toBe(true);
    expect(suggestion!.endsWith("-2")).toBe(true);
  });

  it("returns null rather than looping forever when everything is taken", () => {
    expect(suggestSlug("Two Little Fish", () => true)).toBeNull();
  });
});
