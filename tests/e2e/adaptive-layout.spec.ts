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

async function textBlock(page: import("@playwright/test").Page) {
  return page.locator(".cm-scroller").evaluate((scroller) => {
    const frame = scroller.getBoundingClientRect();
    const content = scroller.querySelector(".cm-content")!;
    const line = content.querySelector(".cm-line")!.getBoundingClientRect();
    const box = content.getBoundingClientRect();
    return {
      left: line.left - frame.left,
      top: line.top - frame.top,
      width: box.width,
      right: frame.right - box.right,
    };
  });
}

// Classic's inset: ceil((window − container − 15) / 2) + 5 at the side and
// floor(lineHeight) − 1 at the top, with a 0.54em Nitti Pro space.
for (const [width, fontSize, left, top, measure] of [
  [735, "16px", 14, 22, 693],
  [860, "19px", 12, 26, 822],
  [1280, "24px", 114, 32, 1038],
] as const) {
  test(`a ${width}px window insets ${fontSize} text ${left}px from the side and ${top}px from the top`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Document text" });
    await expect(editor).toHaveCSS("font-size", fontSize);
    const block = await textBlock(page);
    expect(block.left).toBe(left);
    expect(block.top).toBe(top);
    expect(block.width).toBe(measure);
    expect(block.right).toBeGreaterThan(0);
  });
}

test("resizing changes the type size and keeps text inside the window", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  await expect(editor).toHaveCSS("font-size", "19px");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(editor).toHaveCSS("font-size", "24px");
  await page.setViewportSize({ width: 600, height: 640 });
  await expect(editor).toHaveCSS("font-size", "16px");
  const block = await textBlock(page);
  expect(block.left).toBe(14);
  expect(block.right).toBeGreaterThan(0);
});
