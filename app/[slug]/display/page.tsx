// Display shell (§22.1 header only). Phase 0 proves the tokens, Archivo and the dark
// canvas render; the columns, realtime and sound land in Phase 4.
// The shop name is a hardcoded stub until app/[slug]/layout.tsx resolves it (Phase 2).
export default function DisplayPage({ params }: { params: { slug: string } }) {
  const shopName = "Two Little Fish";

  return (
    <main className="h-[100dvh] flex flex-col bg-canvas text-white overflow-hidden">
      <header className="flex flex-col gap-2 px-4 py-3 md:px-10 md:py-6">
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-extrabold uppercase tracking-wide">
          {shopName}
        </h1>
        <div className="flex items-center gap-4">
          <a
            href={`/${params.slug}/staff`}
            className="font-display text-xs md:text-sm font-bold uppercase tracking-wider text-muted-gray whitespace-nowrap"
          >
            Staff →
          </a>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-preparing" />
            <span className="font-display text-xs md:text-sm font-bold uppercase tracking-wider text-muted-gray whitespace-nowrap">
              Reconnecting
            </span>
          </div>
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-empty-muted font-display font-bold text-2xl md:text-4xl uppercase tracking-wide">
          Phase 0 shell
        </p>
      </div>
    </main>
  );
}
