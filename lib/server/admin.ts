import "server-only";
import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { serverEnv } from "@/lib/env";

const APP_NAME = "chipcheck-admin";

/**
 * Singleton firebase-admin init from base64 FIREBASE_SERVICE_ACCOUNT_JSON (§26).
 * The Admin SDK bypasses security rules and is the ONLY write path (§10).
 */
export function adminApp(): App {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;

  // Emulator path: lets Phase 1's transaction and purge code be exercised against real
  // Firestore semantics in the sandbox and in CI, with no service account (§28 assumed
  // this was impossible; the emulator does in fact run here — see PROGRESS.md).
  //
  // Fenced so it can never weaken a real deployment: a production build refuses to take
  // this branch even if the variable is somehow set, and the project id comes from a
  // dedicated variable rather than from any credential.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
      throw new Error("FIRESTORE_EMULATOR_HOST must never be set in production");
    }
    return initializeApp(
      { projectId: process.env.FIREBASE_EMULATOR_PROJECT_ID ?? "demo-chipcheck" },
      APP_NAME,
    );
  }

  const raw = serverEnv().FIREBASE_SERVICE_ACCOUNT_JSON;
  let parsed: ServiceAccount & { project_id?: string };
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    // Never echo the value.
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid base64-encoded JSON");
  }

  return initializeApp({ credential: cert(parsed) }, APP_NAME);
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

/** Project id of the initialised app — safe to expose (§13 /api/health). */
export function adminProjectId(): string {
  return (adminApp().options.credential as unknown as { projectId?: string })?.projectId
    ?? getApp(APP_NAME).options.projectId
    ?? "unknown";
}
