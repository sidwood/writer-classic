import { expect, test } from "./support/fresh-storage";
import { readFile } from "node:fs/promises";

test("cancelled and failed native saves abort close; success closes only after write", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const events = new Map<string, number>();
    let serial = 0;
    const bridge = {
      savePath: null as string | null,
      failure: "",
      calls: [] as { command: string; args: Record<string, unknown> }[],
      menu(action: string) {
        callbacks.get(events.get("menu-action")!)?.({ payload: action });
      },
    };
    Object.assign(window, {
      isTauri: true,
      testBridge: bridge,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "document-test" },
          currentWebview: { label: "document-test" },
        },
        transformCallback(callback: (event: unknown) => void) {
          const id = ++serial;
          callbacks.set(id, callback);
          return id;
        },
        async invoke(command: string, args: Record<string, unknown>) {
          bridge.calls.push({ command, args });
          if (command === "classic_font") throw "Font unavailable";
          if (command === "plugin:event|listen") {
            events.set(String(args.event), Number(args.handler));
            return ++serial;
          }
          if (command === "plugin:dialog|save") return bridge.savePath;
          if (command === "write_text" && bridge.failure) throw bridge.failure;
          return null;
        },
      },
    });
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Document text" });
  await expect(page.locator(".browser-title")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) => call.command === "set_document_header",
        ),
      ),
    )
    .toBe(true);
  const header = await page.evaluate(
    () =>
      (window as any).testBridge.calls.find(
        (call: any) => call.command === "set_document_header",
      ).args,
  );
  expect(header).toMatchObject({
    title: "Untitled",
    path: null,
    edited: false,
  });
  expect(Buffer.from(header.icon)).toEqual(
    await readFile("brand/markdown-document-icon.png"),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) =>
            call.command === "plugin:event|listen" &&
            call.args.event === "menu-action",
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => (window as any).testBridge.menu("vim"));
  await expect(page.getByLabel("Vim state")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).testBridge.calls
          .filter((call: any) => call.command === "set_vim_checked")
          .at(-1).args.checked,
    ),
  ).toBe(false);
  await page.evaluate(() => (window as any).testBridge.menu("vim"));
  await expect(page.getByLabel("Vim state")).toHaveText("NORMAL");
  await editor.fill("Unsaved native draft.");
  await page.keyboard.press("Meta+w");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(editor).toHaveText("Unsaved native draft.");
  await page.evaluate(() => {
    const bridge = (window as any).testBridge;
    bridge.savePath = "/fixture/document.md";
    bridge.failure = "Disk is full";
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Disk is full");
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).testBridge.calls.some(
        (call: any) => call.command === "plugin:window|destroy",
      ),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    (window as any).testBridge.failure = "";
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) => call.command === "plugin:window|destroy",
        ),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as any).testBridge.calls.find(
          (call: any) => call.command === "write_text",
        ).args,
    ),
  ).toMatchObject({
    path: "/fixture/document.md",
    text: "Unsaved native draft.",
    expected: null,
  });
});
