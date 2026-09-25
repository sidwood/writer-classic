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
    const glyph = (needle: string) => {
      const walker = document.createTreeWalker(
        document.querySelector(".cm-content")!,
        NodeFilter.SHOW_TEXT,
      );
      let node = walker.nextNode();
      while (node) {
        const text = node.textContent ?? "";
        const start = text.indexOf(needle);
        if (start >= 0) {
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + needle.length);
          const box = range.getBoundingClientRect();
          return {
            left: box.left - frame.left,
            right: box.right - frame.left,
            top: box.top - frame.top,
          };
        }
        node = walker.nextNode();
      }
      return { left: 0, right: 0, top: Number.NaN };
    };
    const heading = [...line.querySelectorAll("span")].find((span) =>
      span.textContent?.includes("Morning"),
    );
    const mark = document.querySelector(".cm-md-mark");
    const quote = glyph(">");
    return {
      lineLeft: line.getBoundingClientRect().left - frame.left,
      wordLeft: glyph("The").left,
      morningLeft: glyph("Morning").left,
      milkLeft: glyph("milk").left,
      shelfLeft: glyph("Shelf").left,
      shelfTop: glyph("Shelf").top,
      hashTop: glyph("##").top,
      pourLeft: glyph("Pour").left,
      pourTop: glyph("Pour").top,
      oneTop: glyph("1.").top,
      waitLeft: glyph("Wait").left,
      waitTop: glyph("Wait").top,
      twoTop: glyph("2.").top,
      quoteLeft: quote.left,
      quoteRight: quote.right,
      leaveLeft: glyph("Leave").left,
      headingWeight: heading
        ? Number.parseInt(getComputedStyle(heading).fontWeight, 10)
        : 0,
      markWeight: mark
        ? Number.parseInt(getComputedStyle(mark).fontWeight, 10)
        : 700,
      footerHeight: document.querySelector("footer")!.getBoundingClientRect()
        .height,
    };
  });
  expect(Math.abs(edges.lineLeft - 52)).toBeLessThanOrEqual(8);
  expect(Math.abs(edges.wordLeft - 79)).toBeLessThanOrEqual(8);
  expect(Math.abs(edges.morningLeft - 79)).toBeLessThanOrEqual(8);
  expect(Math.abs(edges.milkLeft - 79)).toBeLessThanOrEqual(8);
  expect(Math.abs(edges.shelfLeft - 79)).toBeLessThanOrEqual(8);
  expect(Math.abs(edges.pourLeft - 79)).toBeLessThanOrEqual(8);
  expect(Math.abs(edges.waitLeft - 79)).toBeLessThanOrEqual(8);
  expect(Math.abs(edges.shelfTop - edges.hashTop)).toBeLessThanOrEqual(4);
  expect(Math.abs(edges.pourTop - edges.oneTop)).toBeLessThanOrEqual(4);
  expect(Math.abs(edges.waitTop - edges.twoTop)).toBeLessThanOrEqual(4);
  expect(Math.abs(edges.quoteLeft - 79)).toBeLessThanOrEqual(8);
  expect(edges.quoteLeft).toBeGreaterThan(71);
  expect(Math.abs(edges.leaveLeft - 97.5)).toBeLessThanOrEqual(8);
  expect(Math.abs(edges.footerHeight - 22)).toBeLessThanOrEqual(2);
  expect(edges.headingWeight).toBeGreaterThanOrEqual(600);
  expect(edges.markWeight).toBeLessThan(600);

  await page.getByText("Morning", { exact: true }).click();
  const headingButton = page.getByRole("button", { name: "Heading 1" });
  await expect(headingButton).toHaveAttribute("aria-pressed", "true");
  const headingColor = await headingButton.evaluate(
    (element) => getComputedStyle(element).color,
  );
  expect(headingColor).not.toBe("rgb(0, 174, 239)");
  expect(headingColor).toBe("rgb(28, 28, 23)");
  await expect(page.getByRole("button", { name: "Emphasis" })).toHaveCSS(
    "color",
    "rgb(178, 176, 174)",
  );

  const typeface = page.getByRole("combobox", { name: "Typeface" });
  await expect(page.locator(".workflow-choice")).toHaveCSS("opacity", "0");
  await typeface.focus();
  await expect(typeface).toBeFocused();
  await expect(typeface).toHaveValue("1");

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
