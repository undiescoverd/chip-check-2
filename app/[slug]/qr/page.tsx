"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useShop } from "../ShopProvider";

/**
 * `/{slug}/qr` — the printable QR (§22.3), a port of v1's `app/qr/page.tsx`.
 *
 * Target URL resolution is a v1 gap fixed: `NEXT_PUBLIC_SITE_URL` first, falling back to
 * `window.location.origin` only when it is unset, so a Preview deploy without the env var
 * still prints something scannable instead of a broken link.
 */
export default function QrPage() {
  const { slug, name } = useShop();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (typeof window === "undefined" ? "" : window.location.origin);
  const target = `${origin}/${slug}/display`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(target, { width: 512, margin: 2 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't generate the QR code");
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-4 md:p-8 bg-canvas text-white">
      <header className="no-print flex flex-col items-center gap-2 w-full">
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-wide">
          Print QR
        </h1>
        <a
          href={`/app/${slug}`}
          className="font-display text-xs md:text-sm font-bold uppercase tracking-wider text-muted-gray whitespace-nowrap"
        >
          ← Settings
        </a>
      </header>
      <section className="print-card flex flex-col items-center gap-4 bg-white text-canvas rounded-2xl p-8 max-w-sm w-full">
        <h2 className="font-display text-lg font-extrabold uppercase tracking-wide text-center">
          Scan to see your order
        </h2>
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
        {!error && !dataUrl && (
          <div className="w-64 h-64 flex items-center justify-center">
            <span className="font-display text-sm font-bold uppercase tracking-wider text-canvas/60">
              Generating…
            </span>
          </div>
        )}
        {dataUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing for next/image to optimize
          <img
            src={dataUrl}
            alt="QR code linking to the live order display"
            className="w-64 h-64"
          />
        )}
        <p className="text-center text-xs text-canvas/60 break-all">{target}</p>
        <p className="font-display text-base font-extrabold uppercase tracking-wide text-center">
          {name}
        </p>
      </section>
      <div className="no-print flex flex-col sm:flex-row gap-3 w-full max-w-sm">
        <a
          href={dataUrl ?? undefined}
          download={`${slug}-qr.png`}
          aria-disabled={!dataUrl}
          className="flex-1 h-14 rounded-2xl bg-white text-canvas font-display text-lg font-extrabold uppercase tracking-wide flex items-center justify-center aria-disabled:opacity-40 aria-disabled:pointer-events-none"
        >
          Download PNG
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex-1 h-14 rounded-2xl bg-white/5 text-white font-display text-lg font-extrabold uppercase tracking-wide"
        >
          Print
        </button>
      </div>
    </main>
  );
}
