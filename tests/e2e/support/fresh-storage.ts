import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

/**
 * Removes every `writer-classic.*` key, including `writer-classic.draft.*`,
 * before the page's first load, so the editor opens an empty document.
 * It runs once per tab: reloads and later navigations keep what the test
 * stored. Register it before any spec fixture that seeds its own keys.
 */
export function clearWriterStorage(page: Page) {
  return page.addInitScript(() => {
    const marker = "writer-classic-test.storage-cleared";
    if (sessionStorage.getItem(marker)) return;
    sessionStorage.setItem(marker, "1");
    for (const key of Object.keys(localStorage))
      if (key.startsWith("writer-classic.")) localStorage.removeItem(key);
  });
}

/** Playwright `test` whose `page` always starts from empty Writer Classic storage. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await clearWriterStorage(page);
    await use(page);
  },
});
