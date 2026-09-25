import { expect, test } from "./support/fresh-storage";

for (const [width, fontSize, lineHeight] of [
  [849, "16px", "23.6026px"],
  [850, "19px", "27.854px"],
  [1064, "19px", "27.854px"],
  [1065, "24px", "33.718px"],
] as const) {
  test(`a ${width}px window sets Classic type to ${fontSize}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Document text" });
    await expect(editor).toHaveCSS("font-size", fontSize);
    await expect(editor).toHaveCSS("line-height", lineHeight);
  });
}

async function measure(page: import("@playwright/test").Page) {
  return page
    .getByRole("textbox", { name: "Document text" })
    .evaluate((element) => {
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = getComputedStyle(element).font;
      const box = element.getBoundingClientRect();
      return {
        width: box.width,
        expected: Math.ceil(context.measureText("0").width * 80 + 11),
        left: box.left,
        right: window.innerWidth - box.right,
      };
    });
}

test("the 860px window keeps the full 80-glyph measure", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  await expect(editor).toHaveCSS("font-size", "19px");
  const { width, expected } = await measure(page);
  expect(width).toBe(expected);
});

test("resizing changes the type size and keeps an 80-glyph measure", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  await expect(editor).toHaveCSS("font-size", "19px");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(editor).toHaveCSS("font-size", "24px");
  const { width, expected, left, right } = await measure(page);
  expect(width).toBe(expected);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(16);
  await page.setViewportSize({ width: 700, height: 640 });
  await expect(editor).toHaveCSS("font-size", "16px");
});
