import { Suspense } from "react";
import { DisplayShell } from "./DisplayShell";

// §22.1: the two columns, the realtime listener, the chime and Wake Lock (Phase 4).
// The shop name comes from app/[slug]/layout.tsx.
//
// Suspense wraps `DisplayShell` because it reads `?sound=` via `useSearchParams` — Next
// requires a boundary around any client component that does, so a client-side navigation
// has a fallback to show while the search params resolve. The layout above is already
// `force-dynamic`, so this is belt-and-braces rather than load-bearing.
export default function DisplayPage() {
  return (
    <Suspense fallback={null}>
      <DisplayShell />
    </Suspense>
  );
}
