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

// At 735 the mark gutter starts at 52 and the column is 616. Wider windows
// centre eighty spaces of the face that draws. Classic's Nitti Pro is not
// loaded here, so that face is Menlo. Top inset is floor(lineHeight) − 1.
for (const [width, fontSize, left, top, measure] of [
  [735, "16px", 52, 22, 616],
  [860, "19px", 12, 26, 821],
  [1280, "24px", 54, 32, 1157],
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

test("the column is sized for the face that draws, and says which", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const editor = page.locator(".writer-editor");
  await expect(editor).toHaveAttribute("data-face", "Menlo");
  const { spaceEm, width } = await editor.evaluate((element) => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = "24px Menlo";
    return {
      spaceEm: Number((element as HTMLElement).dataset.spaceEm),
      width: context.measureText(" ").width,
    };
  });
  expect(spaceEm).toBeCloseTo(width / 24, 4);
  const block = await textBlock(page);
  expect(block.width + 10).toBe(Math.ceil(width * 80 + 11));
});

for (const [state, fontSize] of [
  ["0", "17px"],
  ["2", "14px"],
] as const) {
  test(`workflow state ${state} uses Classic's ${fontSize} step at 735`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 735, height: 640 });
    await page.addInitScript(
      (value) => localStorage.setItem("writer-classic.workflow", value),
      state,
    );
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Document text" });
    await expect(editor).toHaveCSS("font-size", fontSize);
    await expect(page.locator(".writer-editor")).toHaveAttribute(
      "data-workflow",
      state,
    );
  });
}

test("the Typeface control writes the workflow state and changes Classic's size step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 735, height: 640 });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  const typeface = page.getByRole("combobox", { name: "Typeface" });
  await expect(typeface).toHaveValue("1");
  await expect(editor).toHaveCSS("font-size", "16px");
  for (const [state, fontSize] of [
    ["0", "17px"],
    ["2", "14px"],
    ["3", "14px"],
    ["1", "16px"],
  ] as const) {
    await typeface.selectOption(state);
    await expect(editor).toHaveCSS("font-size", fontSize);
    await expect(page.locator(".writer-editor")).toHaveAttribute(
      "data-workflow",
      state,
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem("writer-classic.workflow"),
      ),
    ).toBe(state);
  }
  await typeface.selectOption("2");
  await page.reload();
  await expect(editor).toHaveCSS("font-size", "14px");
});

test("leaving the Typeface control unchanged hands typing back to the document", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  const typeface = page.getByRole("combobox", { name: "Typeface" });
  await typeface.focus();
  await expect(typeface).toHaveValue("1");
  await typeface.evaluate((select) => (select as HTMLSelectElement).blur());
  await expect(editor).toBeFocused();
  await page.keyboard.press("i");
  await page.keyboard.type("Back in the text.");
  await expect(editor).toHaveText("Back in the text.");
});
