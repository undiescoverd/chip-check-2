"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type UserCredential,
} from "firebase/auth";
import { InlineError, Page, PageTitle, PrimaryButton } from "@/components/owner/primitives";
import { auth } from "@/lib/firebase/client";

/**
 * Google sign-in (§7.1 steps 1–5).
 *
 * Popup first, redirect as a fallback. §7.1 names the two error codes that mean "this
 * browser cannot do popups" — in-app browsers and some tablets — and Part I risk #7
 * flags that Safari ITP can break the redirect flow on `*.firebaseapp.com`. Popup is the
 * default precisely because it avoids that path for the common case of an owner on a
 * laptop.
 */
const POPUP_UNAVAILABLE = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
]);

/** The user closing the popup is not an error worth shouting about. */
const USER_ABANDONED = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
]);

const SIGN_IN_FAILED = "Sign-in failed — try again";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only ever redirect within this app — an absolute `?next` would make this an open
  // redirect, which is a nasty thing to hang off a sign-in page.
  const rawNext = params.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app";

  /**
   * Exchange the ID token for the session cookie, then sign the client SDK out — the
   * cookie is the session (§7.1 step 5). Two sources of truth would be worse than one.
   */
  const exchange = useCallback(
    async (credential: UserCredential) => {
      const idToken = await credential.user.getIdToken();

      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      await signOut(auth()).catch(() => {
        // Best effort. The cookie is already set or already failed; a lingering client
        // session does not change what the server will accept.
      });

      if (!res.ok) throw new Error("session_exchange_failed");

      router.replace(next);
      router.refresh();
    },
    [next, router],
  );

  // A redirect sign-in lands back here; pick the result up on load.
  useEffect(() => {
    let cancelled = false;

    getRedirectResult(auth())
      .then((credential) => {
        if (cancelled || !credential) return;
        setBusy(true);
        return exchange(credential);
      })
      .catch(() => {
        if (!cancelled) {
          setError(SIGN_IN_FAILED);
          setBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [exchange]);

  async function onSignIn() {
    setError(null);
    setBusy(true);

    const provider = new GoogleAuthProvider();

    try {
      await exchange(await signInWithPopup(auth(), provider));
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";

      if (POPUP_UNAVAILABLE.has(code)) {
        try {
          // Navigates away; nothing after this runs on success.
          await signInWithRedirect(auth(), provider);
          return;
        } catch {
          setError(SIGN_IN_FAILED);
          setBusy(false);
          return;
        }
      }

      if (USER_ABANDONED.has(code)) {
        setBusy(false);
        return;
      }

      setError(SIGN_IN_FAILED);
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageTitle>Sign in</PageTitle>
      <PrimaryButton onClick={onSignIn} disabled={busy}>
        Continue with Google
      </PrimaryButton>
      <InlineError>{error}</InlineError>
    </Page>
  );
}
