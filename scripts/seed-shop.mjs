#!/usr/bin/env node
/**
 * Seed the Phase 1 test shop.
 *
 * Works against either the Firestore emulator or a real project:
 *   - emulator:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-shop.mjs
 *   - dev:       FIREBASE_SERVICE_ACCOUNT_JSON=<base64> node scripts/seed-shop.mjs
 *
 * Options:
 *   --slug=<slug>        shop slug and document id      (default: test-shop)
 *   --pin=<digits>       staff PIN, 4-8 digits           (default: 4321)
 *   --min=<n> --max=<n>  ticket digit range             (default: 1 and 4)
 *   --stale              also seed an order whose createdAt is 7 h in the past, for the
 *                        cron purge check in Phase 1's Definition of Done
 *   --reset              delete the shop's existing orders and locks first
 *
 * Writes nothing outside the named shop. The PIN is hashed with the same scrypt
 * parameters as `lib/server/pin.ts` (§7.2), so the seeded shop really does unlock.
 */
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const scrypt = promisify(scryptCb);

/** Mirrors lib/server/pin.ts — scrypt$N$salt$hash, N=2^15, r=8, p=1, 64 bytes. */
async function hashPin(pin) {
  const salt = randomBytes(16);
  // 128 * N * r is exactly Node's default maxmem at these parameters, so raise it.
  const hash = await scrypt(pin, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const slug = String(args.get("slug") ?? "test-shop");
const min = Number(args.get("min") ?? 1);
const max = Number(args.get("max") ?? 4);
const pin = String(args.get("pin") ?? "4321");
const seedStale = args.has("stale");

if (!/^\d{4,8}$/.test(pin)) {
  console.error("--pin must be 4-8 digits");
  process.exit(1);
}
const reset = args.has("reset");

if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 6 || max < min) {
  console.error("--min/--max must be integers with 1 <= min <= max <= 6");
  process.exit(1);
}

function init() {
  const projectId = process.env.FIREBASE_EMULATOR_PROJECT_ID ?? "demo-chipcheck";

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`Using the Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
    return initializeApp({ projectId });
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error(
      "Set FIREBASE_SERVICE_ACCOUNT_JSON (base64 service-account JSON) or FIRESTORE_EMULATOR_HOST.",
    );
    process.exit(1);
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    console.log(`Using project ${parsed.project_id}`);
    return initializeApp({ credential: cert(parsed) });
  } catch {
    // Never echo the value.
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid base64-encoded JSON");
    process.exit(1);
  }
}

const db = getFirestore(init());
const shopRef = db.collection("shops").doc(slug);

async function deleteAll(collection) {
  const snap = await collection.get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
}

if (reset) {
  const orders = await deleteAll(shopRef.collection("orders"));
  const locks = await deleteAll(shopRef.collection("activeNumbers"));
  console.log(`Reset: removed ${orders} orders and ${locks} locks`);
}

await shopRef.set(
  {
    name: "Test Shop",
    slug,
    ownerUid: "seed-script",
    createdAt: FieldValue.serverTimestamp(),
    settings: {
      ticketMinDigits: min,
      ticketMaxDigits: max,
      readyTimeoutSeconds: 300,
      targetPrepSeconds: 480,
      soundEnabled: false,
      timezone: "Europe/London",
    },
    // Pilot, so the entitlement gate is open regardless of the billing flag (§15).
    isPilot: true,
  },
  { merge: true },
);

await db.collection("slugs").doc(slug).set({ shopId: slug });

await shopRef.collection("private").doc("auth").set({
  pinHash: await hashPin(pin),
  pinUpdatedAt: FieldValue.serverTimestamp(),
});

// Start from a clean lockout state so a re-seed is never born rate-limited (§7.2).
await shopRef.collection("private").doc("pinAttempts").set({ attempts: {} });

await shopRef.collection("private").doc("billing").set({
  status: "pilot",
  updatedAt: FieldValue.serverTimestamp(),
});

let staleId = null;
if (seedStale) {
  const sevenHoursAgo = Timestamp.fromMillis(Date.now() - 7 * 60 * 60 * 1000);
  const orderNumber = "9".repeat(Math.min(max, 4));
  const ref = shopRef.collection("orders").doc();

  await ref.set({
    orderNumber,
    status: "preparing",
    createdAt: sevenHoursAgo,
    readyAt: null,
    cleared: false,
    clearedAt: null,
    clearedBy: null,
  });
  await shopRef.collection("activeNumbers").doc(orderNumber).set({
    orderId: ref.id,
    createdAt: sevenHoursAgo,
  });

  staleId = ref.id;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      shopId: slug,
      slug,
      settings: { ticketMinDigits: min, ticketMaxDigits: max },
      staleOrderId: staleId,
    },
    null,
    2,
  ),
);
