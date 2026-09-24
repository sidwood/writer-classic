import { expect, test } from "@playwright/test";
for (const exit of ["Control+[", "Control+c"])
  test(`visual change ends undo grouping on ${exit}`, async ({ page }) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Document text" });
    await editor.fill("one two\nthree");
    await editor.click();
    await page.keyboard.press("Escape");
    await page.keyboard.type("gg0vcX");
    await page.keyboard.press(exit);
    await page.keyboard.type("A!");
    await page.keyboard.press("Escape");
    await page.keyboard.press("u");
    await expect(editor).toHaveText("Xne twothree");
  });
test("c as a visual-line replacement argument is literal, not a change command", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  await editor.fill("one two\nthree");
  await editor.click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("gg0Vrc");
  await expect(editor).toHaveText("cccccccthree");
  await page.keyboard.press("u");
  await expect(editor).toHaveText("one twothree");
});
test("visual s is one undo and visual C keeps the following line", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  await editor.fill("one two\nthree");
  await editor.click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("gg0vsX");
  await page.keyboard.press("Escape");
  await page.keyboard.press("u");
  await expect(editor).toHaveText("one twothree");
  await page.keyboard.type("gg0VC");
  await page.keyboard.type("Z");
  await page.keyboard.press("Escape");
  await expect(editor.locator(".cm-line")).toHaveText(["Z", "three"]);
});
test("find and register arguments are not consumed as visual change", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  await editor.fill("one two\nthree");
  await editor.click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("gg0Vfc");
  await expect(editor.locator(".cm-line")).toHaveText(["one two", "three"]);
  await page.keyboard.press("Escape");
  await page.keyboard.type('gg0V"cy');
  await expect(editor.locator(".cm-line")).toHaveText(["one two", "three"]);
});
