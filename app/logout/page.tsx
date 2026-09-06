"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Page, PageTitle } from "@/components/owner/primitives";

/**
 * `/logout` (§21): calls `DELETE /api/auth/session`, then goes home.
 *
 * A page rather than a link so the cookie is actually cleared and refresh tokens revoked
 * server-side (§7.1 step 7); a plain link to `/` would leave the session alive.
 */
export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/session", { method: "DELETE" })
      .catch(() => {
        // The route is best-effort by design (§13). Either way the user asked to leave,
        // so send them on rather than stranding them here.
      })
      .finally(() => {
        if (cancelled) return;
        router.replace("/");
        router.refresh();
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <Page>
      <PageTitle>Signing out…</PageTitle>
    </Page>
  );
}
