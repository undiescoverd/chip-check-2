import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * §10 allow/deny matrix.
 *
 * These rules are the only thing standing between the public internet and the database —
 * the Admin SDK bypasses them, so every client, honest or not, is governed entirely by
 * what is asserted here.
 *
 * The rules deliberately never reference `request.auth`: the client SDK is used
 * unauthenticated (§7.1), so there is no signed-in path that could drift into "owner can
 * write". Everything below runs as an unauthenticated context for that reason.
 */

const PROJECT_ID = "demo-chipcheck";
const SHOP = "shop1";

let testEnv: RulesTestEnvironment;
let db: Firestore;

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const [hostname, port] = host.split(":");

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: hostname,
      port: Number(port),
    },
  });

  // `firestore()` hands back the compat (namespaced) Firestore type, while the modular
  // `doc`/`getDoc`/`setDoc` helpers are typed against the v9 `Firestore`. They interoperate
  // at runtime — it is the pattern in the library's own JSDoc — but the two types are
  // structurally different, so the boundary needs one cast.
  db = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  // Seed through the admin escape hatch, which is the only way anything gets written.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, "shops", SHOP), { name: "Test", slug: "test-shop" });
    await setDoc(doc(admin, "shops", SHOP, "orders", "order1"), {
      orderNumber: "0042",
      status: "preparing",
      cleared: false,
    });
    await setDoc(doc(admin, "shops", SHOP, "private", "auth"), { pinHash: "scrypt$..." });
    await setDoc(doc(admin, "shops", SHOP, "private", "billing"), { status: "pilot" });
    await setDoc(doc(admin, "shops", SHOP, "activeNumbers", "0042"), { orderId: "order1" });
    await setDoc(doc(admin, "slugs", "test-shop"), { shopId: SHOP });
    await setDoc(doc(admin, "users", "uid1"), { email: "owner@example.test" });
    await setDoc(doc(admin, "config", "flags"), { billingEnabled: false });
    await setDoc(doc(admin, "stripeEvents", "evt1"), { type: "invoice.paid" });
  });
});

describe("public reads", () => {
  it("anyone can get a shop — the board is public by design", async () => {
    await assertSucceeds(getDoc(doc(db, "shops", SHOP)));
  });

  it("anyone can get a single order", async () => {
    await assertSucceeds(getDoc(doc(db, "shops", SHOP, "orders", "order1")));
  });

  it("anyone can list a shop's orders — this is what the display subscribes to", async () => {
    await assertSucceeds(getDocs(collection(db, "shops", SHOP, "orders")));
  });

  it("anyone can resolve a slug", async () => {
    await assertSucceeds(getDoc(doc(db, "slugs", "test-shop")));
  });
});

describe("tenant enumeration", () => {
  it("nobody can list shops — the slug is the capability", async () => {
    await assertFails(getDocs(collection(db, "shops")));
  });

  it("nobody can list slugs either", async () => {
    await assertFails(getDocs(collection(db, "slugs")));
  });
});

describe("server-only collections are unreadable", () => {
  it("refuses private/auth, which holds the PIN hash", async () => {
    await assertFails(getDoc(doc(db, "shops", SHOP, "private", "auth")));
  });

  it("refuses private/billing, which holds the Stripe ids", async () => {
    await assertFails(getDoc(doc(db, "shops", SHOP, "private", "billing")));
  });

  it("refuses listing the private collection", async () => {
    await assertFails(getDocs(collection(db, "shops", SHOP, "private")));
  });

  it("refuses activeNumbers, which would leak the dedupe state", async () => {
    await assertFails(getDoc(doc(db, "shops", SHOP, "activeNumbers", "0042")));
  });

  it("refuses users", async () => {
    await assertFails(getDoc(doc(db, "users", "uid1")));
  });

  it("refuses config", async () => {
    await assertFails(getDoc(doc(db, "config", "flags")));
  });

  it("refuses stripeEvents", async () => {
    await assertFails(getDoc(doc(db, "stripeEvents", "evt1")));
  });
});

describe("every write is denied", () => {
  it("cannot create an order — the whole point of the Route Handler write path", async () => {
    await assertFails(
      setDoc(doc(db, "shops", SHOP, "orders", "forged"), {
        orderNumber: "9999",
        status: "preparing",
        cleared: false,
      }),
    );
  });

  it("cannot mark an order ready directly", async () => {
    await assertFails(updateDoc(doc(db, "shops", SHOP, "orders", "order1"), { status: "ready" }));
  });

  it("cannot clear an order directly", async () => {
    await assertFails(updateDoc(doc(db, "shops", SHOP, "orders", "order1"), { cleared: true }));
  });

  it("cannot delete an order — there are no hard deletes", async () => {
    await assertFails(deleteDoc(doc(db, "shops", SHOP, "orders", "order1")));
  });

  it("cannot edit a shop's settings", async () => {
    await assertFails(updateDoc(doc(db, "shops", SHOP), { name: "Hijacked" }));
  });

  it("cannot create a shop", async () => {
    await assertFails(setDoc(doc(db, "shops", "newshop"), { name: "Mine" }));
  });

  it("cannot claim a slug", async () => {
    await assertFails(setDoc(doc(db, "slugs", "grabbed"), { shopId: "whatever" }));
  });

  it("cannot free a lock doc to force a duplicate through", async () => {
    await assertFails(deleteDoc(doc(db, "shops", SHOP, "activeNumbers", "0042")));
  });

  it("cannot write the PIN hash", async () => {
    await assertFails(setDoc(doc(db, "shops", SHOP, "private", "auth"), { pinHash: "mine" }));
  });

  it("cannot grant itself a subscription", async () => {
    await assertFails(setDoc(doc(db, "shops", SHOP, "private", "billing"), { status: "active" }));
  });

  it("cannot flip the billing flag", async () => {
    await assertFails(setDoc(doc(db, "config", "flags"), { billingEnabled: false }));
  });

  it("cannot forge a processed Stripe event", async () => {
    await assertFails(setDoc(doc(db, "stripeEvents", "evt2"), { type: "invoice.paid" }));
  });

  it("cannot write a user document", async () => {
    await assertFails(setDoc(doc(db, "users", "uid1"), { shopIds: ["anything"] }));
  });
});

describe("undeclared paths", () => {
  it("denies a collection the rules never mention", async () => {
    await assertFails(getDoc(doc(db, "somethingNew", "doc1")));
    await assertFails(setDoc(doc(db, "somethingNew", "doc1"), { a: 1 }));
  });

  it("denies an unmatched subcollection under a shop", async () => {
    await assertFails(getDoc(doc(db, "shops", SHOP, "secrets", "doc1")));
  });
});
