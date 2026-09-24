import { expect, test, type Page } from "@playwright/test";

async function menu(page: Page, name: string, item: string) {
  const details = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: name }) });
  if (!(await details.getAttribute("open")))
    await details.locator("summary").click();
  await details.locator("button", { hasText: item }).click({ force: true });
  await details.evaluate((element) => element.removeAttribute("open"));
}

test("delete, smart paste, detections, and help follow the Classic menu", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("writer-classic.vim", "false");
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  await editor.click();
  await page.keyboard.type("abcdef");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await menu(page, "Edit", "Delete");
  await expect(editor).toHaveText("abcdf");
  await page.evaluate(async () => {
    await navigator.clipboard.writeText("world");
  });
  await page.keyboard.press("Meta+ArrowRight");
  await page.keyboard.press("Meta+v");
  await expect(editor).toHaveText("abcdf world");
  await menu(page, "Edit", "Smart Copy/Paste");
  await editor.click();
  await page.keyboard.press("Meta+ArrowRight");
  await page.keyboard.press("Meta+v");
  await expect(editor).toHaveText("abcdf worldworld");
  await editor.fill(
    "See https://example.com/notes and 415-555-0134 on 2024-03-15.",
  );
  await expect(page.locator(".detected-link")).toHaveCount(1);
  await expect(page.locator(".detected-phone")).toHaveCount(1);
  await expect(page.locator(".detected-date")).toHaveCount(1);
  await menu(page, "Edit", "Data Detection");
  await expect(page.locator(".detected-phone")).toHaveCount(0);
  await expect(page.locator(".detected-link")).toHaveCount(1);
  const help = page.waitForEvent("popup");
  await menu(page, "Help", "Writer Classic Help");
  await expect(
    (await help).getByRole("heading", { name: "Writer Classic Help" }),
  ).toBeVisible();
  await menu(page, "Window", "Bring All to Front");
});
