import { expect, test } from "@playwright/test";
import { MAX_DIGITS, SHOP_SLUG, STAFF_PIN, isLocal } from "./env";
import {
  addOrder,
  backdateOrder,
  card,
  consoleHeading,
  ordersApi,
  uniqueNumber,
  unlock,
} from "./helpers";

/**
 * The Phase 3 smoke (Part H task 5) plus the Definition of Done items a browser can
 * settle: the per-shop digit rule, the double-tap guard, the gate's inline errors, the
 * age escalation, the undo affordance and the shed nudge.
 *
 * Everything here drives the real console against a real listener — locally that is
 * `next dev` on the Firestore emulator, and unchanged against the `dev` alias once it
 * exists (see `tests/e2e/env.ts`). Two tests need to backdate a document to avoid an
 * eight-minute wait and skip themselves in the remote mode.
 */

test.describe("PIN gate (§22.2)", () => {
  test("a wrong PIN says so inline and stays on the gate", async ({ page }) => {
    await page.goto(`/${SHOP_SLUG}/staff`);
    await page.getByLabel("Staff PIN").fill("000000");
    await page.getByRole("button", { name: "Unlock" }).click();

    // v1 showed nothing here and only failed later, on the first write.
    await expect(page.getByText("Wrong PIN")).toBeVisible();
    await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
    await expect(consoleHeading(page)).toBeHidden();
  });

  test("the right PIN shows the console without a reload", async ({ page }) => {
    await page.goto(`/${SHOP_SLUG}/staff`);

    // A marker only a document reload can erase. `framenavigated` is the wrong instrument
    // here: Next's router touches the History API on a refresh, so it reports a
    // navigation for something the user never sees.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__beforeUnlock = true;
    });

    await page.getByLabel("Staff PIN").fill(STAFF_PIN);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(consoleHeading(page)).toBeVisible();

    // `router.refresh()` re-renders the server component in place; a reload here would be
    // the white flash v1 had on a wall-mounted tablet.
    const survived = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__beforeUnlock === true,
    );
    expect(survived).toBe(true);
  });
});

test.describe("the console", () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
  });

  test("the digit rule is the shop's own", async ({ page }) => {
    // The shop is seeded at 2–5 digits (Phase 3 Definition of Done).
    const add = page.getByRole("button", { name: "+ Add Order" });
    const field = page.getByLabel("Order number");

    await page.getByRole("button", { name: "1", exact: true }).click();
    await expect(add).toBeDisabled();

    await page.getByRole("button", { name: "2", exact: true }).click();
    await expect(add).toBeEnabled();

    // A sixth digit is refused by the keypad rather than truncated later.
    for (const digit of ["3", "4", "5", "6"]) {
      await page.getByRole("button", { name: digit, exact: true }).click();
    }
    await expect(field).toHaveValue("12345");
    expect((await field.inputValue()).length).toBe(MAX_DIGITS);

    await page.getByRole("button", { name: "Clear", exact: true }).first().click();
    await expect(field).toHaveValue("");
  });

  test("the server refuses a six-digit number even when the keypad is bypassed", async ({
    page,
  }) => {
    const { status, body } = await ordersApi(page.request, {
      action: "add",
      orderNumber: "123456",
    });

    expect(status).toBe(400);
    expect(body).toMatchObject({ error: "invalid_order_number", min: 2, max: 5 });
  });

  test("add, mark ready, recall, clear — and a second tablet sees each change", async ({
    page,
    context,
  }) => {
    const number = uniqueNumber();

    // The second tablet, unlocked by the same cookie, watching the same shop.
    const second = await context.newPage();
    await second.goto(`/${SHOP_SLUG}/staff`);
    await expect(consoleHeading(second)).toBeVisible();

    await addOrder(page, number);
    await expect(card(page, number)).toBeVisible();

    // §11's target is 1.5 s from tap to the other device; Firestore typically delivers in
    // 200–600 ms. The generous timeout is for CI, not for the product.
    await expect(card(second, number)).toBeVisible({ timeout: 5_000 });
    await expect(card(second, number)).toHaveAttribute("data-status", "preparing");

    await card(page, number).getByRole("button", { name: "Ready" }).click();
    await expect(card(page, number)).toHaveAttribute("data-status", "ready");
    await expect(card(second, number)).toHaveAttribute("data-status", "ready");

    await card(page, number).getByRole("button", { name: "Recall" }).click();
    await expect(card(page, number)).toHaveAttribute("data-status", "preparing");
    await expect(card(second, number)).toHaveAttribute("data-status", "preparing");

    await card(page, number).getByRole("button", { name: "Clear" }).click();
    await expect(card(page, number)).toHaveCount(0);
    await expect(card(second, number)).toHaveCount(0);

    await second.close();
  });

  test("double-tapping Ready fires exactly one request", async ({ page }) => {
    const number = uniqueNumber();
    await addOrder(page, number);
    await expect(card(page, number)).toBeVisible();

    const mutations: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/orders")) {
        mutations.push(request.postData() ?? "");
      }
    });

    // Both the pending set and the in-flight ref exist for this: the second tap lands
    // before React has repainted the button as disabled.
    await card(page, number).getByRole("button", { name: "Ready" }).dblclick();
    await expect(card(page, number)).toHaveAttribute("data-status", "ready");
    await page.waitForTimeout(500);

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toContain("markReady");

    await card(page, number).getByRole("button", { name: "Clear" }).click();
  });

  test("clear offers an undo that restores the order", async ({ page }) => {
    const number = uniqueNumber();
    await addOrder(page, number);
    await card(page, number).getByRole("button", { name: "Ready" }).click();
    await expect(card(page, number)).toHaveAttribute("data-status", "ready");

    await card(page, number).getByRole("button", { name: "Clear" }).click();
    await expect(card(page, number)).toHaveCount(0);
    await expect(page.getByText(`Cleared #${number}`)).toBeVisible();

    // §25: the undo offer is announced politely, not as an alert — it is an offer, and
    // interrupting a screen reader mid-sentence to make one would be its own defect.
    await expect(page.locator('[role="status"]').filter({ hasText: `Cleared #${number}` })).toHaveCount(1);

    await page.getByRole("button", { name: "Undo" }).click();

    // §13: `clear` does not touch `status`, so an order cleared while ready comes back
    // ready rather than back in the queue.
    await expect(card(page, number)).toBeVisible();
    await expect(card(page, number)).toHaveAttribute("data-status", "ready");
    await expect(page.getByText("Undone")).toBeVisible();

    await card(page, number).getByRole("button", { name: "Clear" }).click();
  });

  test("the undo offer goes away on the next mutation", async ({ page }) => {
    const cleared = uniqueNumber();
    await addOrder(page, cleared);
    await card(page, cleared).getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText(`Cleared #${cleared}`)).toBeVisible();

    // §22.2: the offer stands for 10 s *or* until the next mutation. Leaving a stale
    // "Undo" on screen after the next order is added is how the wrong row gets restored.
    const next = uniqueNumber();
    await addOrder(page, next);
    await expect(card(page, next)).toBeVisible();
    await expect(page.getByText(`Cleared #${cleared}`)).toHaveCount(0);

    await card(page, next).getByRole("button", { name: "Clear" }).click();
  });

  test("an undo of a number that went active again is refused, in words", async ({ page }) => {
    const number = uniqueNumber();
    await addOrder(page, number);
    await expect(card(page, number)).toBeVisible();

    await card(page, number).getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText(`Cleared #${number}`)).toBeVisible();

    // Someone else takes the number back — the lock is gone, so it is theirs.
    const retaken = await ordersApi(page.request, { action: "add", orderNumber: number });
    expect(retaken.status).toBe(200);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(`Couldn't undo — #${number} is active again`)).toBeVisible();

    // The re-added order is untouched by the refused undo.
    await expect(card(page, number)).toHaveCount(1);
    await card(page, number).getByRole("button", { name: "Clear" }).click();
  });

  test("a duplicate add opens the duplicate modal", async ({ page }) => {
    const number = uniqueNumber();
    await addOrder(page, number);
    await expect(card(page, number)).toBeVisible();

    await addOrder(page, number);
    await expect(page.getByText("Order already active")).toBeVisible();
    await expect(
      page.getByText(
        `Order #${number} is already active (preparing). Clear it first, or use a different number.`,
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "OK" }).click();
    await card(page, number).getByRole("button", { name: "Clear" }).click();
  });

  test("Clear All empties the board through its confirmation", async ({ page }) => {
    await ordersApi(page.request, { action: "clearAll" });

    const first = uniqueNumber();
    const second = uniqueNumber();
    await addOrder(page, first);
    await addOrder(page, second);
    await expect(page.getByText("2 in queue")).toBeVisible();

    await page.getByRole("button", { name: "Clear All", exact: true }).first().click();
    await expect(page.getByText("Clear all orders?")).toBeVisible();
    await expect(
      page.getByText("This will clear all 2 active orders from the board. This can't be undone."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Clear All", exact: true }).last().click();
    await expect(page.getByText("No active orders.")).toBeVisible();
  });

  test("an old order escalates its age without changing colour", async ({ page }) => {
    test.skip(!isLocal, "backdating an order needs direct Firestore access");

    const number = uniqueNumber();
    const added = await ordersApi(page.request, { action: "add", orderNumber: number });
    const order = added.body.order as { id: string };

    // Ten minutes old against the shop's default eight-minute target (§9).
    await backdateOrder(order.id, { createdAt: Date.now() - 10 * 60_000 });

    const row = card(page, number);
    await expect(row).toBeVisible();
    const age = row.getByTestId("order-age");
    await expect(age).toHaveAttribute("data-over-target", "true", { timeout: 5_000 });
    await expect(age).toHaveText("10m");
    // The No-Third-Colour Rule (§20): the escalation is weight and a pill, and the row is
    // still the same amber it was at one minute old.
    await expect(row).toHaveClass(/bg-preparing/);

    await row.getByRole("button", { name: "Clear" }).click();
  });

  test("the shed nudge offers only the ready orders nobody is collecting", async ({ page }) => {
    test.skip(!isLocal, "backdating an order needs direct Firestore access");

    await ordersApi(page.request, { action: "clearAll" });

    const stale = uniqueNumber();
    const preparing = uniqueNumber();

    const staleAdd = await ordersApi(page.request, { action: "add", orderNumber: stale });
    const staleOrder = staleAdd.body.order as { id: string };
    await ordersApi(page.request, { action: "markReady", id: staleOrder.id });
    // Ready ten minutes ago, against the shop's five-minute ready timeout — so it has
    // already dropped off the customer display.
    await backdateOrder(staleOrder.id, { readyAt: Date.now() - 10 * 60_000 });

    await ordersApi(page.request, { action: "add", orderNumber: preparing });

    const nudge = page.getByTestId("shed-nudge");
    await expect(nudge).toHaveText("1 ready over 5 min — clear?", { timeout: 5_000 });

    await nudge.click();
    await expect(page.getByText("Clear 1 ready orders?")).toBeVisible();
    await page.getByRole("button", { name: "Clear All", exact: true }).last().click();

    // The nudge clears the stale ready order and nothing else — the preparing one is
    // still being cooked.
    await expect(card(page, stale)).toHaveCount(0);
    await expect(card(page, preparing)).toHaveCount(1);
    await expect(nudge).toHaveCount(0);

    await card(page, preparing).getByRole("button", { name: "Clear" }).click();
  });

  test("the header reports the listener's state", async ({ page }) => {
    await expect(page.getByTestId("connection-dot")).toHaveAttribute("data-status", "connected");
    await expect(page.getByText("Live")).toBeVisible();
  });
});

/**
 * The pixel comparison against v1 is Ian's, by eye, side by side (§28a). This produces
 * the four widths §24 names, as run artefacts, so the comparison does not need a tablet
 * in hand.
 */
test.describe("layout artefacts", () => {
  const widths = [390, 768, 1024, 1280];

  for (const width of widths) {
    test(`console at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 800 });
      await unlock(page);

      const number = uniqueNumber();
      await addOrder(page, number);
      await expect(card(page, number)).toBeVisible();
      await card(page, number).getByRole("button", { name: "Ready" }).click();
      await expect(card(page, number)).toHaveAttribute("data-status", "ready");

      const second = uniqueNumber();
      await addOrder(page, second);
      await expect(card(page, second)).toBeVisible();

      // Written to a real file rather than attached from memory: CI uploads the output
      // directory, and an attachment without a path only survives inside an HTML report.
      const file = testInfo.outputPath(`staff-${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(`staff-${width}.png`, { path: file, contentType: "image/png" });

      await card(page, number).getByRole("button", { name: "Clear" }).click();
      await card(page, second).getByRole("button", { name: "Clear" }).click();
    });
  }
});
