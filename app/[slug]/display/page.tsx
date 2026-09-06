import { DisplayShell } from "./DisplayShell";

// Display shell (§22.1 header only). The columns, realtime and sound land in Phase 4.
// The shop name now comes from app/[slug]/layout.tsx rather than the Phase 0 stub.
export default function DisplayPage() {
  return <DisplayShell />;
}
