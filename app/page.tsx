import Link from "next/link";

// Landing page (§22.4). Plain Tailwind on the §20 tokens — not NextUI — so it matches
// the shop screens. Sign-in becomes real in Phase 2.
export default function Home() {
  const demoSlug = process.env.NEXT_PUBLIC_DEMO_SLUG;

  return (
    <main className="min-h-screen bg-canvas text-white p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-lg flex flex-col gap-6">
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-wide">
          Chip Check
        </h1>
        <p className="text-sm text-muted-gray text-balance">
          A live ticket-number board for your counter — TV, tablet and phone, in sync.
        </p>
        <Link
          href="/login"
          className="h-14 rounded-2xl bg-white text-canvas font-display text-lg font-extrabold uppercase tracking-wide flex items-center justify-center"
        >
          Sign in with Google
        </Link>
        {demoSlug ? (
          <Link
            href={`/${demoSlug}/display`}
            className="h-14 rounded-2xl bg-canvas-elevated text-white font-display text-lg font-extrabold uppercase tracking-wide flex items-center justify-center"
          >
            See a demo board
          </Link>
        ) : null}
      </div>
    </main>
  );
}
