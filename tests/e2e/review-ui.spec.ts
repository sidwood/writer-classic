import { expect, test } from "@playwright/test";
test("Vim Control commands remain editor commands and indicators remain visible", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  await editor.click();
  await page.keyboard.type("iabcdef");
  await page.keyboard.press("Escape");
  await page.keyboard.type("0xu");
  await page.keyboard.press("Control+r");
  await expect(editor).toHaveText("bcdef");
  expect(page.context().pages()).toHaveLength(1);
  for (const [key, mode] of [
    ["v", "VISUAL"],
    ["V", "VISUAL LINE"],
    ["Control+v", "VISUAL BLOCK"],
  ]) {
    await page.mouse.move(400, 300);
    await page.waitForTimeout(500);
    await page.keyboard.press(key);
    await expect(page.getByLabel("Vim state")).toHaveText(mode);
    expect(
      await page.getByLabel("Vim state").evaluate((el) => {
        let opacity = 1;
        for (let e: Element | null = el; e; e = e.parentElement)
          opacity *= Number(getComputedStyle(e).opacity);
        return opacity;
      }),
    ).toBe(1);
    await page.keyboard.press("Escape");
  }
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Control+w");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
});
test("dark preview uses the same root palette and responds to toggles", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Meta+Alt+d");
  const popupPromise = page.waitForEvent("popup");
  await page.keyboard.press("Meta+r");
  const popup = await popupPromise;
  await expect
    .poll(() =>
      popup.evaluate(() => getComputedStyle(document.body).backgroundColor),
    )
    .toBe("rgb(32, 33, 36)");
  await page.keyboard.press("Meta+Alt+d");
  await expect
    .poll(() =>
      popup.evaluate(() => getComputedStyle(document.body).backgroundColor),
    )
    .toBe("rgb(240, 240, 240)");
});
