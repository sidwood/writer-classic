import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./support/fresh-storage";

const sample = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sample.md",
);

test("the 735 sample shot keeps Classic's gutter, type, marks, and footer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 735, height: 615 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(sample);
  const editor = page.getByRole("textbox", { name: "Document text" });
  await expect(editor).toContainText("The kettle is on.");
  await expect(page.locator(".writer-editor")).toHaveAttribute(
    "data-face",
    "Menlo",
  );
  const fontFamily = await editor.evaluate(
    (element) => getComputedStyle(element).fontFamily,
  );
  expect(fontFamily).toContain("Menlo");
  await expect(editor).toHaveCSS("font-size", "16px");
  await expect(editor).toHaveCSS("line-height", "23.6026px");

  const edges = await page.evaluate(() => {
    const frame = document
      .querySelector(".cm-scroller")!
      .getBoundingClientRect();
    const line = document.querySelector(".cm-line")!;
    const body = [...document.querySelectorAll(".cm-line")].find((item) =>
      item.textContent?.includes("kettle"),
    )!;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let wordLeft = 0;
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const start = text.indexOf("The");
      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + "The".length);
        wordLeft = range.getBoundingClientRect().left - frame.left;
        break;
      }
      node = walker.nextNode();
    }
    const heading = [...line.querySelectorAll("span")].find((span) =>
      span.textContent?.includes("Morning"),
    );
    const mark = document.querySelector(".cm-md-mark");
    return {
      lineLeft: line.getBoundingClientRect().left - frame.left,
      wordLeft,
      headingWeight: heading
        ? Number.parseInt(getComputedStyle(heading).fontWeight, 10)
        : 0,
      markWeight: mark
        ? Number.parseInt(getComputedStyle(mark).fontWeight, 10)
        : 700,
    };
  });
  expect(Math.abs(edges.lineLeft - 52)).toBeLessThanOrEqual(8);
  expect(Math.abs(edges.wordLeft - 79)).toBeLessThanOrEqual(8);
  expect(edges.headingWeight).toBeGreaterThanOrEqual(600);
  expect(edges.markWeight).toBeLessThan(600);

  const footer = page.locator("footer");
  await expect(footer).toContainText("Focus Off");
  await expect(footer).toContainText("- List");
  await expect(footer).toContainText("1. List");
  await expect(footer).toContainText("Link");
  await expect(footer).toContainText("134 C");
  await expect(footer).toContainText("24 W");
  await expect(footer).toContainText("00:00:07");
  await expect(page.locator(".unfocused-sentence")).toHaveCount(0);
});
