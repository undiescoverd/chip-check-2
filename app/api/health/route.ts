import { NextResponse } from "next/server";
import { adminProjectId } from "@/lib/server/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proves the Admin SDK initialises from FIREBASE_SERVICE_ACCOUNT_JSON (Phase 0 DoD).
 * Returns the project id only — never a secret, never a stack trace (§14).
 */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, project: adminProjectId() });
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_configuration" }, { status: 500 });
  }
}
