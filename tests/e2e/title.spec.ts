import { expect, test } from "./support/fresh-storage";

for (const width of [860, 1280]) {
  test(`browser title is centered with Markdown icon immediately to its left at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto("/");
    const icon = page.getByRole("img", { name: "Markdown document" });
    await expect(icon).toBeVisible();
    expect(
      await icon.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    ).toBe(true);
    await page.locator("input[type=file]").setInputFiles({
      name: "A document title.md",
      mimeType: "text/plain",
      buffer: Buffer.from("Content"),
    });
    const title = page.locator(".document-title");
    await expect(title).toHaveText("A document title.md");
    await page.getByRole("textbox", { name: "Document text" }).fill("Changed");
    await expect(title).toHaveText("A document title.md");
    await expect(page).toHaveTitle("A document title.md");
    const finder = page.getByRole("button", { name: "Show in Finder" });
    await expect(finder).toBeVisible();
    expect(
      await finder.evaluate((button) => button.closest(".browser-title")),
    ).toBeNull();
    const cluster = (await page.locator(".browser-title").boundingBox())!;
    expect(Math.abs(cluster.x + cluster.width / 2 - width / 2)).toBeLessThan(1);
    const iconBox = (await icon.boundingBox())!,
      titleBox = (await title.boundingBox())!;
    expect(titleBox.x - iconBox.x - iconBox.width).toBe(6);
    expect(await page.locator(".browser-title").count()).toBe(1);
  });
}
test("browser tab title is the document title before any edit", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Untitled");
  await expect(page.getByRole("button", { name: "Show in Finder" })).toHaveCount(
    0,
  );
});
