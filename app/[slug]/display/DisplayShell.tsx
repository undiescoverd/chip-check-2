"use client";

import { LayoutGroup } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Column } from "@/components/display/Column";
import { Chime, nextSeenReady, seedSeenReady } from "@/lib/display/chime";
import { visibleOrders } from "@/lib/orders/visible";
import { useOrders } from "@/lib/useOrders";
import { useShop } from "../ShopProvider";

/**
 * The customer board (§22.1), a port of v1's `app/display/page.tsx`. Phase 0 shipped the
 * header only (see the git history of this file); everything below it — the two columns,
 * the realtime listener, the chime and Wake Lock — is this phase.
 *
 * No order age here (§22.2 puts that on the staff console only) — this screen shows
 * numbers, not how late they are.
 */
export function DisplayShell() {
  const { shopId, slug, name, settings } = useShop();
  const { orders, status } = useOrders(shopId);
  const searchParams = useSearchParams();

  // `?sound=0` forces off even when the shop has sound on; `?sound=1` forces on for a TV
  // whose shop setting is off (§22.1).
  const soundParam = searchParams.get("sound");
  const soundEnabled =
    soundParam === "0" ? false : soundParam === "1" ? true : settings.soundEnabled;

  const connected = status === "connected";
  const visible = visibleOrders(orders, settings.readyTimeoutSeconds, Date.now());
  const preparing = visible.filter((o) => o.status === "preparing");
  const ready = visible.filter((o) => o.status === "ready");
  const bothEmpty = preparing.length === 0 && ready.length === 0;

  // Rendered only after mount (§22.1) — `toLocaleTimeString` depends on the visitor's
  // locale and timezone, which the server cannot know, so painting it during SSR would be
  // a hydration mismatch waiting to happen.
  const [clock, setClock] = useState<string | null>(null);
  useEffect(() => {
    const format = () =>
      setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    format();
    const id = setInterval(format, 1_000);
    return () => clearInterval(id);
  }, []);

  // --- Sound: one Chime for the page's lifetime, seeded once on first connect. ---
  const chimeRef = useRef<Chime>(undefined as unknown as Chime);
  if (!chimeRef.current) chimeRef.current = new Chime();
  const seenRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const [soundReady, setSoundReady] = useState(false);

  useEffect(() => {
    if (!soundEnabled || status !== "connected" || seededRef.current) return;
    seenRef.current = seedSeenReady(orders);
    seededRef.current = true;
  }, [soundEnabled, status, orders]);

  useEffect(() => {
    if (!soundEnabled || !seededRef.current) return;
    const { newlyReadyIds, seen } = nextSeenReady(seenRef.current, orders);
    seenRef.current = seen;
    if (newlyReadyIds.length > 0) chimeRef.current.play();
  }, [soundEnabled, orders]);

  // First gesture resumes the AudioContext (§22.1) — a one-shot listener, removed as soon
  // as it fires once.
  useEffect(() => {
    if (!soundEnabled || soundReady) return;
    const onGesture = () => {
      void chimeRef.current.resume().then(() => setSoundReady(true));
    };
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [soundEnabled, soundReady]);

  const showSoundHint = soundEnabled && !soundReady;

  // --- Wake Lock: a toggle, re-acquired whenever the tab comes back or the OS drops it
  // while the toggle is still on (§22.1, §24). ---
  const [wakeLockOn, setWakeLockOn] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  async function acquireWakeLock() {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
    } catch {
      // Most commonly the document went hidden between the request and the grant — the
      // visibilitychange handler below re-tries once it is visible again.
    }
  }

  function toggleWakeLock() {
    if (wakeLockOn) {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockOn(false);
    } else {
      setWakeLockOn(true);
      void acquireWakeLock();
    }
  }

  useEffect(() => {
    if (!wakeLockOn) return;
    function onVisibility() {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        void acquireWakeLock();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [wakeLockOn]);

  // --- Fullscreen: hidden entirely when the API is unsupported (§22.1). ---
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  useEffect(() => {
    setFullscreenSupported(typeof document !== "undefined" && document.fullscreenEnabled);
  }, []);

  function enterFullscreen() {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  const headerLink =
    "font-display text-xs md:text-sm font-bold uppercase tracking-wider text-muted-gray whitespace-nowrap";

  return (
    <main className="h-[100dvh] flex flex-col bg-canvas text-white overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <header className="flex flex-col gap-2 px-4 py-3 md:px-10 md:py-6">
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-extrabold uppercase tracking-wide">
          {name}
        </h1>
        <div className="flex items-center gap-4">
          <a href={`/${slug}/staff`} className={headerLink}>
            Staff →
          </a>
          <div className="flex items-center gap-2">
            <span
              data-testid="connection-dot"
              data-status={status}
              className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-ready" : "bg-preparing"}`}
            />
            <span className={headerLink}>{connected ? "Live" : "Reconnecting"}</span>
          </div>
          {clock !== null && <span className={`${headerLink} tabular-nums`}>{clock}</span>}
          <button type="button" onClick={toggleWakeLock} className={headerLink}>
            {`Screen: ${wakeLockOn ? "on" : "off"}`}
          </button>
          {fullscreenSupported && (
            <button type="button" onClick={enterFullscreen} className={headerLink}>
              Fullscreen
            </button>
          )}
        </div>
      </header>
      <LayoutGroup>
        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          <Column
            title="Preparing"
            orders={preparing}
            variant="preparing"
            headerClass="bg-preparing text-preparing-text"
          />
          <Column
            title="Ready · Collect"
            orders={ready}
            variant="ready"
            headerClass="bg-ready text-ready-text"
          />
        </div>
      </LayoutGroup>
      {bothEmpty && (
        <footer className="text-center py-4 font-display font-bold text-muted-gray text-sm md:text-base uppercase tracking-wide">
          Order at the counter — your number will appear here
        </footer>
      )}
      {showSoundHint && (
        <p
          role="status"
          className="text-center pb-2 font-display text-xs font-bold text-muted-gray uppercase tracking-wide"
        >
          Tap to enable sound
        </p>
      )}
    </main>
  );
}
