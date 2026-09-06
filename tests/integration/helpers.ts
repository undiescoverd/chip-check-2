import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/admin";
import { activeNumberRef, ordersRef, shopRef } from "@/lib/server/shops";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

export const PROJECT_ID = process.env.FIREBASE_EMULATOR_PROJECT_ID ?? "demo-chipcheck";

/** Wipe the emulator between tests so each one starts from a known database. */
export async function clearEmulator(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const url = `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`could not clear emulator: ${res.status}`);
}

export async function seedShop(
  shopId: string,
  settings: Partial<Settings> = {},
  isPilot = true,
): Promise<void> {
  await shopRef(shopId).set({
    name: "Test Shop",
    slug: shopId,
    ownerUid: "uid-test",
    createdAt: FieldValue.serverTimestamp(),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    isPilot,
  });
  await adminDb().collection("slugs").doc(shopId).set({ shopId });
}

export async function lockExists(shopId: string, orderNumber: string): Promise<boolean> {
  return (await activeNumberRef(shopId, orderNumber).get()).exists;
}

export async function lockHolder(shopId: string, orderNumber: string): Promise<string | null> {
  const snap = await activeNumberRef(shopId, orderNumber).get();
  return snap.exists ? (snap.data()?.orderId ?? null) : null;
}

export async function rawOrder(shopId: string, orderId: string) {
  const snap = await ordersRef(shopId).doc(orderId).get();
  return snap.exists ? snap.data() : null;
}

/** Rewrite a timestamp field directly, to age a document without waiting for the clock. */
export async function backdate(
  shopId: string,
  orderId: string,
  field: "createdAt" | "readyAt" | "clearedAt",
  millisAgo: number,
): Promise<void> {
  await ordersRef(shopId)
    .doc(orderId)
    .update({ [field]: Timestamp.fromMillis(Date.now() - millisAgo) });
}

/** Assert an ApiError-shaped rejection and hand back the error for further checks. */
export async function expectApiError(
  promise: Promise<unknown>,
): Promise<{ status: number; code: string; details?: Record<string, unknown> }> {
  try {
    await promise;
  } catch (err) {
    const e = err as { status?: number; code?: string; details?: Record<string, unknown> };
    if (typeof e.status === "number" && typeof e.code === "string") {
      return { status: e.status, code: e.code, details: e.details };
    }
    throw err;
  }
  throw new Error("expected the call to reject, but it resolved");
}
