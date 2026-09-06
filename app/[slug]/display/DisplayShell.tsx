"use client";

import { useShop } from "../ShopProvider";

/**
 * §22.1's header, on the real shop. Everything below it — the two columns, the realtime
 * listener, the chime and Wake Lock — is Phase 4.
 */
export function DisplayShell() {
  const { slug, name } = useShop();

  return (
    <main className="h-[100dvh] flex flex-col bg-canvas text-white overflow-hidden">
      <header className="flex flex-col gap-2 px-4 py-3 md:px-10 md:py-6">
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-extrabold uppercase tracking-wide">
          {name}
        </h1>
        <div className="flex items-center gap-4">
          <a
            href={`/${slug}/staff`}
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
          Phase 4 builds the board
        </p>
      </div>
    </main>
  );
}
