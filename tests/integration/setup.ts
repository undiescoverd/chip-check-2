/**
 * The Admin SDK takes its emulator branch from FIRESTORE_EMULATOR_HOST (see
 * `lib/server/admin.ts`), so no service account is needed. The other secrets still have
 * to parse because `serverEnv()` validates the whole set — these are throwaway values,
 * never real ones.
 */
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
// Phase 2: the Auth emulator implements createSessionCookie/verifySessionCookie, so the
// §7.1 owner flow is exercised for real rather than mocked (see PROGRESS.md).
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIREBASE_EMULATOR_PROJECT_ID ??= "demo-chipcheck";
process.env.FIREBASE_SERVICE_ACCOUNT_JSON ??= "e30=";
process.env.STAFF_SESSION_SECRET ??= "t".repeat(48);
process.env.CRON_SECRET ??= "c".repeat(32);
process.env.BILLING_ENABLED ??= "false";
