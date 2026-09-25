import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { clearWriterStorage } from "./support/fresh-storage";

// One context for both tests reproduces a reused origin: without the shared
// reset, the second test loads the localStorage the first test wrote.
let context: BrowserContext;
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Document text" });

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
});
test.afterAll(async () => {
  await context.close();
});

test("first test leaves sample text in its draft", async () => {
  const page = await context.newPage();
  await clearWriterStorage(page);
  await page.goto("/");
  await editor(page).fill("Leaked sample text");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("writer-classic.draft.browser")),
    )
    .toContain("Leaked sample text");
  await page.close();
});

test("second test on the same origin opens an empty document", async () => {
  const page = await context.newPage();
  await clearWriterStorage(page);
  await page.goto("/");
  await expect(editor(page)).toHaveText("");
  await page.close();
});
