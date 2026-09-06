import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { isReservedSlug } from "@/lib/slugs";
import { adminDb } from "@/lib/server/admin";
import { billingEnabled } from "@/lib/server/entitlement";
import { ApiError } from "@/lib/server/errors";
import { hashPin } from "@/lib/server/pin";
import { resetAllAttempts } from "@/lib/server/pinAttempts";
import { getShop, privateRef, shopRef } from "@/lib/server/shops";
import { userRef } from "@/lib/server/users";
import { SettingsSchema, type Settings, type Shop } from "@/lib/types";

/**
 * Shop creation and settings (§8, §13).
 *
 * Creation is one transaction over five documents. The interesting part is the slug
 * claim: `slugs/{slug}` is read and written inside the transaction, so two owners
 * submitting the same slug at the same moment resolve to exactly one winner and one
 * 409 — the same lock-under-transaction shape as `activeNumbers` in `lib/server/orders.ts`,
 * for the same reason.
 */

export interface CreateShopInput {
  name: string;
  slug: string;
  settings: Settings;
  pin: string;
}

export async function createShop(uid: string, input: CreateShopInput): Promise<Shop> {
  if (isReservedSlug(input.slug)) {
    throw new ApiError(400, "slug_reserved");
  }

  // Hashing costs ~110 ms; doing it inside the transaction would hold the slug lock open
  // for that long and invite contention on a popular slug.
  const pinHash = await hashPin(input.pin);

  // §17: with billing off (the pilot default) every new shop is a pilot shop. Read
  // before the transaction — it is cached for 60 s and must not be a transactional read.
  const enabled = await billingEnabled();
  const isPilot = !enabled;

  const db = adminDb();
  const slugRef = db.collection("slugs").doc(input.slug);
  const shop = db.collection("shops").doc();

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(slugRef);
    if (existing.exists) throw new ApiError(409, "slug_taken");

    tx.set(shop, {
      name: input.name,
      slug: input.slug,
      ownerUid: uid,
      createdAt: FieldValue.serverTimestamp(),
      settings: input.settings,
      isPilot,
    });

    tx.set(slugRef, { shopId: shop.id });

    tx.set(privateRef(shop.id, "auth"), {
      pinHash,
      pinUpdatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(privateRef(shop.id, "billing"), {
      status: isPilot ? "pilot" : "none",
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      userRef(uid),
      { shopIds: FieldValue.arrayUnion(shop.id) },
      { merge: true },
    );
  });

  return getShop(shop.id);
}

export interface UpdateShopInput {
  name?: string;
  settings?: Partial<Settings>;
}

/**
 * Partial update (§13). The slug is deliberately not editable — printed QR codes point
 * at it (§5).
 *
 * Settings are merged over the shop's current values and re-validated as a whole, so a
 * partial write cannot land a combination the schema forbids: sending only
 * `ticketMinDigits: 5` against a stored max of 4 is rejected rather than stored.
 */
export async function updateShop(shopId: string, input: UpdateShopInput): Promise<Shop> {
  const current = await getShop(shopId);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;

  if (input.settings !== undefined) {
    const merged = SettingsSchema.safeParse({ ...current.settings, ...input.settings });
    if (!merged.success) {
      throw new ApiError(400, "invalid_body", { issues: merged.error.issues });
    }
    patch.settings = merged.data;
  }

  if (Object.keys(patch).length > 0) {
    await shopRef(shopId).update(patch);
  }

  return getShop(shopId);
}

/**
 * Set or rotate the staff PIN (§7.2 step 8).
 *
 * Rotation does not invalidate existing `cc_staff` cookies — they expire within 12 h,
 * and §7.2 says so explicitly, so tablets mid-service are not thrown back to the gate.
 * It does clear the attempt counters, which is the documented way out of a lockout
 * (Part I risk #12).
 */
export async function setPin(shopId: string, pin: string): Promise<void> {
  // Confirms the shop exists so a bad id is a 404 rather than a silently created document.
  await getShop(shopId);

  const pinHash = await hashPin(pin);
  await privateRef(shopId, "auth").set(
    { pinHash, pinUpdatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await resetAllAttempts(shopId);
}

/** The stored hash, or null when a shop has somehow never had one set. */
export async function getPinHash(shopId: string): Promise<string | null> {
  const snap = await privateRef(shopId, "auth").get();
  const hash = snap.exists ? snap.data()?.pinHash : undefined;
  return typeof hash === "string" && hash.length > 0 ? hash : null;
}

/** Whether a slug is already claimed. Used by `GET /api/slugs/{slug}` (§13). */
export async function isSlugTaken(slug: string): Promise<boolean> {
  const snap = await adminDb().collection("slugs").doc(slug).get();
  return snap.exists;
}
