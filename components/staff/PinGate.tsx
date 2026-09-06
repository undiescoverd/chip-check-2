"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { unlockStaff } from "@/lib/api";

/**
 * The PIN gate (§22.2).
 *
 * Two v1 gaps close here. v1 kept "unlocked" in `sessionStorage` and showed nothing when
 * the PIN was wrong — the first sign of a bad PIN was a failed write minutes later. v2
 * has no client-side session at all: the server component reads `cc_staff`, and this
 * form's only job is to exchange a PIN for that cookie and then ask the server to
 * re-render.
 *
 * `router.refresh()` rather than a reload: the console arrives without the white flash of
 * a full navigation, which on a wall-mounted tablet is the difference between "it
 * unlocked" and "it restarted".
 */
export function PinGate({ slug }: { slug: string }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await unlockStaff(slug, pin);

    if (result.ok) {
      // Deliberately stays disabled: the refresh replaces this form, and re-enabling it
      // first would offer a second unlock during the round trip.
      setPin("");
      router.refresh();
      return;
    }

    setError(result.error.message);
    setSubmitting(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center safe-pad bg-canvas">
      <form onSubmit={submit} className="flex flex-col gap-4 w-full max-w-xs">
        <h1 className="font-display text-xl font-extrabold uppercase tracking-wide text-center text-white">
          Staff PIN
        </h1>
        <input
          type="password"
          inputMode="numeric"
          placeholder="PIN"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          aria-label="Staff PIN"
          className="h-16 rounded-2xl bg-canvas-elevated text-center font-display text-3xl font-black tabular-nums text-white placeholder:text-base placeholder:font-sans placeholder:font-normal placeholder:text-muted-gray outline-none focus:ring-2 focus:ring-white/20"
        />
        <button
          type="submit"
          disabled={!pin || submitting}
          className="h-14 rounded-2xl bg-white text-canvas font-display text-lg font-extrabold uppercase tracking-wide disabled:opacity-40"
        >
          Unlock
        </button>
        {error && (
          <p role="alert" className="text-center font-display text-sm font-bold text-preparing-bright">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
