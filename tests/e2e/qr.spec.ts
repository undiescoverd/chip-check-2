import { expect, test } from "@playwright/test";
import { SHOP_SLUG } from "./env";

/** `/{slug}/qr` (§22.3): the printable card, its target URL and the print/download pair. */

test.describe("the QR page (§22.3)", () => {
  test("renders a QR image pointing at the display, with the shop name on the card", async ({
    page,
  }) => {
    await page.goto(`/${SHOP_SLUG}/qr`);

    const img = page.getByRole("img", { name: "QR code linking to the live order display" });
    await expect(img).toBeVisible();
    // A real data: URL, not the "Generating…" placeholder left behind.
    await expect(img).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(page.getByText("Generating…")).toHaveCount(0);

    await expect(page.getByText(new RegExp(`/${SHOP_SLUG}/display$`))).toBeVisible();
    await expect(page.getByRole("heading", { name: "Scan to see your order" })).toBeVisible();
  });

  test("the download link is enabled once the code is ready, and the print button exists", async ({
    page,
  }) => {
    await page.goto(`/${SHOP_SLUG}/qr`);
    await expect(page.getByRole("img")).toBeVisible();

    const download = page.getByRole("link", { name: "Download PNG" });
    await expect(download).toHaveAttribute("href", /^data:image\/png;base64,/);
    await expect(download).toHaveAttribute("download", `${SHOP_SLUG}-qr.png`);

    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  });

  test("links back to shop settings", async ({ page }) => {
    await page.goto(`/${SHOP_SLUG}/qr`);
    await expect(page.getByRole("link", { name: "← Settings" })).toHaveAttribute(
      "href",
      `/app/${SHOP_SLUG}`,
    );
  });
});
