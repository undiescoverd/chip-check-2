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
