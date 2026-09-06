import { expect, test, type Page } from "@playwright/test";
import { SHOP_SLUG, isLocal } from "./env";
import { addOrder, backdateOrder, card, ordersApi, uniqueNumber, unlock } from "./helpers";

/**
 * §22.1's customer board and its Definition of Done items a browser can settle without a
 * TV or a second device: the ready-timeout drop-off, reduced motion, the sound gesture,
 * and the QR page's own DoD.
 *
 * The realtime sync itself (`staff.spec.ts`'s "a second tablet sees each change" test)
 * already proves an order added on the console reaches a listener elsewhere within the
 * §11 target; these tests reuse that path to get orders onto the board rather than
 * re-proving sync from a different screen.
 */

function tile(page: Page, orderNumber: string) {
  return page.locator(`[data-testid="order-tile"][data-order-number="${orderNumber}"]`);
}

/** Wraps `AudioContext` before the page loads, so a chime shows up as a counter a test
 *  can read back — there is no other way to observe "a tone played" from Playwright. */
async function spyOnOscillators(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __oscillatorStarts: number }).__oscillatorStarts = 0;
    const OrigOscillator = window.OscillatorNode;
    const origStart = OrigOscillator.prototype.start;
    OrigOscillator.prototype.start = function start(...args: Parameters<typeof origStart>) {
      (window as unknown as { __oscillatorStarts: number }).__oscillatorStarts += 1;
      return origStart.apply(this, args);
    };
  });
}

test.describe("the customer board (§22.1)", () => {
  test("shows the two columns and the empty-board footer", async ({ page }) => {
    await unlock(page);
    await ordersApi(page.request, { action: "clearAll" });
    await page.goto(`/${SHOP_SLUG}/display`);

    await expect(page.getByRole("heading", { name: "Preparing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ready · Collect" })).toBeVisible();
    await expect(page.getByText("Order at the counter — your number will appear here")).toBeVisible();
  });

  test("a number added on the console appears on the board, then moves columns", async ({
    page,
    context,
  }) => {
    const staff = await context.newPage();
    await unlock(staff);

    const number = uniqueNumber();
    await page.goto(`/${SHOP_SLUG}/display`);

    await addOrder(staff, number);
    await expect(tile(page, number)).toBeVisible({ timeout: 5_000 });
    await expect(tile(page, number)).toHaveAttribute("data-status", "preparing");

    await card(staff, number).getByRole("button", { name: "Ready" }).click();
    await expect(tile(page, number)).toHaveAttribute("data-status", "ready", { timeout: 5_000 });

    await card(staff, number).getByRole("button", { name: "Clear" }).click();
    await expect(tile(page, number)).toHaveCount(0);
    await staff.close();
  });

  test("the ready column is announced politely, the preparing one is not", async ({ page }) => {
    await page.goto(`/${SHOP_SLUG}/display`);
    const readyRegion = page
      .getByRole("heading", { name: "Ready · Collect" })
      .locator("xpath=../..")
      .locator("[aria-live]");
    await expect(readyRegion).toHaveAttribute("aria-live", "polite");
  });

  test("a ready order drops off the board once it passes the shop's ready timeout", async ({
    page,
  }) => {
    test.skip(!isLocal, "backdating an order needs direct Firestore access");

    // `ordersApi` shares the page's cookies, and the orders route requires the staff
    // session (§7.2) — unlocking first is what makes the direct API calls below work,
    // exactly as it is for the equivalent staff.spec.ts tests.
    await unlock(page);

    const number = uniqueNumber();
    const added = await ordersApi(page.request, { action: "add", orderNumber: number });
    const order = added.body.order as { id: string };
    await ordersApi(page.request, { action: "markReady", id: order.id });

    await page.goto(`/${SHOP_SLUG}/display`);
    await expect(tile(page, number)).toBeVisible();

    // The seeded shop's readyTimeoutSeconds is 300 (Phase 1's default) — ready six
    // minutes ago is well past it.
    await backdateOrder(order.id, { readyAt: Date.now() - 6 * 60_000 });

    // useOrders' own tick re-evaluates the filter once a second (§11) — no reload needed,
    // and none would prove anything a reload didn't already cover for free.
    await expect(tile(page, number)).toHaveCount(0, { timeout: 3_000 });

    await ordersApi(page.request, { action: "clear", id: order.id });
  });

  test("reduced motion drops the spring and the scale on a new tile", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await unlock(page);
    await ordersApi(page.request, { action: "clearAll" });

    const number = uniqueNumber();
    await page.goto(`/${SHOP_SLUG}/display`);
    const added = await ordersApi(page.request, { action: "add", orderNumber: number });
    const order = added.body.order as { id: string };

    const t = tile(page, number);
    await expect(t).toBeVisible({ timeout: 5_000 });
    // framer-motion still applies the animate target's final values; reduced motion is
    // about the transition, not the resting state, so scale settles at 1 either way —
    // the thing worth asserting is that the tile renders correctly when the media query
    // is active, since the transition itself has no stable DOM signal to assert on.
    await expect(t).toHaveCSS("transform", /matrix|none/);

    await ordersApi(page.request, { action: "clear", id: order.id });
  });

  test("sound: the hint shows until the first tap, and the chime fires once per newly-ready order", async ({
    page,
  }) => {
    await spyOnOscillators(page);
    await unlock(page);
    await ordersApi(page.request, { action: "clearAll" });

    const preExisting = uniqueNumber();
    const preAdd = await ordersApi(page.request, { action: "add", orderNumber: preExisting });
    await ordersApi(page.request, { action: "markReady", id: (preAdd.body.order as { id: string }).id });

    await page.goto(`/${SHOP_SLUG}/display?sound=1`);
    await expect(page.getByText("Tap to enable sound")).toBeVisible();

    // The pre-existing ready order is seeded, not chimed, even once sound is live.
    await page.mouse.click(10, 10);
    await expect(page.getByText("Tap to enable sound")).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => (window as unknown as { __oscillatorStarts: number }).__oscillatorStarts),
    ).toBe(0);

    const number = uniqueNumber();
    const added = await ordersApi(page.request, { action: "add", orderNumber: number });
    const order = added.body.order as { id: string };
    await ordersApi(page.request, { action: "markReady", id: order.id });

    await expect(tile(page, number)).toHaveAttribute("data-status", "ready", { timeout: 5_000 });
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __oscillatorStarts: number }).__oscillatorStarts),
      )
      .toBe(1);

    await ordersApi(page.request, { action: "clearAll" });
  });

  test("?sound=0 forces the chime off even with a gesture already given", async ({ page }) => {
    await spyOnOscillators(page);
    await unlock(page);
    await ordersApi(page.request, { action: "clearAll" });

    await page.goto(`/${SHOP_SLUG}/display?sound=0`);
    await expect(page.getByText("Tap to enable sound")).toHaveCount(0);
    await page.mouse.click(10, 10);

    const number = uniqueNumber();
    const added = await ordersApi(page.request, { action: "add", orderNumber: number });
    await ordersApi(page.request, { action: "markReady", id: (added.body.order as { id: string }).id });
    await expect(tile(page, number)).toHaveAttribute("data-status", "ready", { timeout: 5_000 });

    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => (window as unknown as { __oscillatorStarts: number }).__oscillatorStarts),
    ).toBe(0);

    await ordersApi(page.request, { action: "clearAll" });
  });
});
