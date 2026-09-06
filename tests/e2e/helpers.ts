import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { EMULATOR_PROJECT_ID, FIRESTORE_EMULATOR_HOST, SHOP_SLUG, STAFF_PIN } from "./env";

/** The list heading — "Active Orders", which "No active orders." would otherwise match. */
export function consoleHeading(page: Page) {
  return page.getByRole("heading", { name: "Active Orders" });
}

/** Unlock the console the way staff do: type the PIN, press Unlock, wait for the list. */
export async function unlock(page: Page): Promise<void> {
  await page.goto(`/${SHOP_SLUG}/staff`);
  await page.getByLabel("Staff PIN").fill(STAFF_PIN);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(consoleHeading(page)).toBeVisible();
}

/** Add an order through the UI: type it on the keypad, press Add. */
export async function addOrder(page: Page, orderNumber: string): Promise<void> {
  for (const digit of orderNumber) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "+ Add Order" }).click();
}

export function card(page: Page, orderNumber: string) {
  return page.locator(`[data-testid="order-card"][data-order-number="${orderNumber}"]`);
}

/**
 * The orders API as the console calls it — same cookie, same route. Used to set up state
 * a test needs without driving the UI to get there, and to prove the server refuses what
 * the UI would not have sent.
 */
export async function ordersApi(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.post(`/api/shops/${SHOP_SLUG}/orders`, { data: body });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status(), body: parsed };
}

/**
 * A number that no other test in the run is using. Four digits, so it is valid under the
 * suite's 2–5 digit shop and keyable on the keypad.
 */
let counter = 0;
export function uniqueNumber(): string {
  counter += 1;
  return String(1000 + ((Date.now() + counter * 137) % 9000));
}

/**
 * Direct Firestore access for the two rules that are otherwise untestable inside a
 * 30-second test: the age escalation (default target is eight minutes) and the shed
 * nudge (default ready timeout is five). Backdating a document is the only alternative
 * to waiting, and it is exactly what the server would have written.
 *
 * Local mode only — the callers skip themselves when the suite drives a Preview.
 */
export async function adminDb() {
  process.env.FIRESTORE_EMULATOR_HOST ??= FIRESTORE_EMULATOR_HOST;
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ projectId: EMULATOR_PROJECT_ID }, "e2e");

  return getFirestore(app);
}

/** Move an order's timestamps into the past, as if it had been sitting there. */
export async function backdateOrder(
  orderId: string,
  fields: { createdAt?: number; readyAt?: number },
): Promise<void> {
  const db = await adminDb();
  const { Timestamp } = await import("firebase-admin/firestore");

  const update: Record<string, unknown> = {};
  if (fields.createdAt !== undefined) update.createdAt = Timestamp.fromMillis(fields.createdAt);
  if (fields.readyAt !== undefined) update.readyAt = Timestamp.fromMillis(fields.readyAt);

  await db.collection("shops").doc(SHOP_SLUG).collection("orders").doc(orderId).update(update);
}
