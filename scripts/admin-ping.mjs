#!/usr/bin/env node
/**
 * Proves the sandbox/CI can reach the dev Firebase project with the Admin SDK
 * (Phase 0 DoD). Reads only — writes nothing.
 *
 *   FIREBASE_SERVICE_ACCOUNT_JSON=<base64> node scripts/admin-ping.mjs
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
  process.exit(1);
}

let credentials;
try {
  credentials = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
} catch {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid base64-encoded JSON.");
  process.exit(1);
}

const app = initializeApp({ credential: cert(credentials) });
const db = getFirestore(app);

try {
  const snap = await db.collection("shops").limit(1).get();
  console.log(
    JSON.stringify({ ok: true, project: credentials.project_id, shopsRead: snap.size }, null, 2),
  );
  process.exit(0);
} catch (err) {
  console.error("Admin read failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
