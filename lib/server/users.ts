import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/admin";
import { toShop } from "@/lib/server/firestore";
import { shopRef } from "@/lib/server/shops";
import type { Shop } from "@/lib/types";

/**
 * `users/{uid}` (§9). Server-only in `firestore.rules` — the owner never reads this
 * document through the client SDK, so `/app` lists shops through the Admin SDK.
 */

export function userRef(uid: string) {
  return adminDb().collection("users").doc(uid);
}

/** §7.1 step 4: upsert on every sign-in. Merge, so `shopIds` is never clobbered. */
export async function upsertUser(
  uid: string,
  email: string | null,
  displayName: string | null,
): Promise<void> {
  await userRef(uid).set(
    {
      email: email ?? "",
      displayName: displayName ?? "",
      lastLoginAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * The owner's shops, for `/app`.
 *
 * Reads `users/{uid}.shopIds` and then the shop documents by id. `shops` cannot be
 * queried by `ownerUid` from the client (§10 denies `list` so tenants cannot be
 * enumerated), and adding a server-side query would need an index §9 does not declare —
 * the id list is the intended path.
 *
 * A missing shop id is skipped rather than failing the page: an id can outlive its
 * document if a shop is ever removed by hand in the console.
 */
export async function listOwnerShops(uid: string): Promise<Shop[]> {
  const snap = await userRef(uid).get();
  const raw = snap.exists ? snap.data()?.shopIds : undefined;
  const shopIds: string[] = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  if (shopIds.length === 0) return [];

  const docs = await adminDb().getAll(...shopIds.map((id) => shopRef(id)));

  return docs
    .filter((doc) => doc.exists)
    .map((doc) => toShop(doc.id, doc.data()!))
    // Defence in depth: the id list should only ever contain this owner's shops, but the
    // shop document's own ownerUid is the authority (§6).
    .filter((shop) => shop.ownerUid === uid)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}
