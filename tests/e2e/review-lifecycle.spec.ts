import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks = new Map(),
      events = new Map();
    let id = 0;
    localStorage.clear();
    localStorage.setItem("writer-classic.vim", "false");
    localStorage.setItem(
      "writer-classic.draft.document-risk",
      JSON.stringify({ path: "/fixture/a.md", text: "old", savedText: "old" }),
    );
    const bridge: any = {
      calls: [],
      disk: "externally updated",
      delayed: false,
      menu(action: string) {
        callbacks.get(events.get("menu-action"))?.({ payload: action });
      },
      async invoke(command: string, args: any) {
        this.calls.push({ command, args });
        if (command === "classic_font") throw "unavailable";
        if (command === "plugin:event|listen") {
          events.set(args.event, args.handler);
          return ++id;
        }
        if (command === "read_text") return this.disk;
        if (command === "write_text") {
          if (this.delayed)
            await new Promise((resolve) => (this.release = resolve));
          this.disk = args.text;
        }
        if (command === "plugin:dialog|save") return "/fixture/a.md";
        return null;
      },
    };
    Object.assign(window, {
      isTauri: true,
      testBridge: bridge,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "document-risk" },
          currentWebview: { label: "document-risk" },
        },
        transformCallback(callback: any) {
          callbacks.set(++id, callback);
          return id;
        },
        invoke: (command: string, args: any) => bridge.invoke(command, args),
      },
    });
  });
  await page.goto("/");
  await page.waitForFunction(() =>
    (window as any).testBridge.calls.some(
      (c: any) =>
        c.command === "plugin:event|listen" && c.args.event === "menu-action",
    ),
  );
});
test("Escape invalidates a delayed Save-and-Close and preserves later edits", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "Document text" });
  await editor.fill("save before close");
  await page.evaluate(() => ((window as any).testBridge.delayed = true));
  await page.keyboard.press("Meta+w");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.waitForFunction(() => !!(window as any).testBridge.release);
  await page.keyboard.press("Escape");
  await editor.fill("new text after cancellation");
  await page.evaluate(() => (window as any).testBridge.release());
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("writer-classic.draft.document-risk") ||
              "null",
          )?.savedText,
      ),
    )
    .toBe("save before close");
  expect(
    await page.evaluate(() =>
      (window as any).testBridge.calls.filter(
        (c: any) => c.command === "plugin:window|destroy",
      ),
    ),
  ).toEqual([]);
  await expect(editor).toHaveText("new text after cancellation");
});
test("Cancel resumes named-document autosave", async ({ page }) => {
  await page
    .getByRole("textbox", { name: "Document text" })
    .fill("cancel test");
  await page.keyboard.press("Meta+w");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).testBridge.disk), {
      timeout: 5000,
    })
    .toBe("cancel test");
});
test("clean recovery reloads the current file", async ({ page }) => {
  await expect(page.getByRole("textbox", { name: "Document text" })).toHaveText(
    "externally updated",
  );
});
test("Cancel of Last Opened also resumes autosave", async ({ page }) => {
  await page
    .getByRole("textbox", { name: "Document text" })
    .fill("after opened cancel");
  await page.evaluate(() => (window as any).testBridge.menu("last-opened"));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).testBridge.disk), {
      timeout: 5000,
    })
    .toBe("after opened cancel");
});
