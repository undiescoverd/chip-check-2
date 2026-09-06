import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

/**
 * Browser Firestore client. Read path only — the browser NEVER writes orders (§3, §10).
 * These NEXT_PUBLIC_ values are safe to expose; the security rules are the boundary.
 * The client SDK is used unauthenticated, so rules never reference request.auth (§7.1).
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function clientApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

/**
 * Set only by the local end-to-end harness (`playwright.config.ts`), never in Preview or
 * Production. It is fenced twice: the branch is compiled out of a production build by the
 * `NODE_ENV` check, and it is applied once per app instance.
 *
 * The point of it: the Playwright smoke drives a real browser against a real listener, so
 * the client SDK has to reach the emulator the same way `adminApp()` does on the server
 * (PROGRESS.md deviation 10). Without it the browser would try to reach Firestore proper
 * and the whole realtime half of the console would be untested here.
 */
const emulatorHost =
  process.env.NODE_ENV === "production"
    ? undefined
    : process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;

let firestore: Firestore | undefined;

export function db(): Firestore {
  if (firestore) return firestore;

  firestore = getFirestore(clientApp());

  if (emulatorHost) {
    const [host, port] = emulatorHost.split(":");
    connectFirestoreEmulator(firestore, host, Number(port));
  }

  return firestore;
}

/**
 * Firebase Auth, used for exactly one thing: obtaining a Google ID token to exchange for
 * the `cc_session` cookie (§7.1 steps 1–2).
 *
 * This does NOT weaken the invariant above. The client signs out immediately after the
 * exchange (§7.1 step 5), so Firestore reads stay anonymous and `firestore.rules` still
 * never references `request.auth`. The cookie is the session; the SDK is a token source.
 */
export function auth(): Auth {
  return getAuth(clientApp());
}
