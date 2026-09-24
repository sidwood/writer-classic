import { expect, test } from "@playwright/test";

function install(
  page: import("@playwright/test").Page,
  options: {
    label?: string;
    draft?: string;
    disk?: string;
    failRead?: boolean;
    vim?: string;
    delayRead?: boolean;
    recovered?: boolean;
  } = {},
) {
  const label = options.label ?? "document-risk";
  return page.addInitScript(
    ({ label, draft, disk, failRead, vim, delayRead, recovered }) => {
      const callbacks = new Map<number, (event: unknown) => void>();
      const events = new Map<string, number>();
      let id = 0;
      localStorage.clear();
      localStorage.setItem("writer-classic.vim", vim ?? "false");
      if (draft) localStorage.setItem(`writer-classic.draft.${label}`, draft);
      if (recovered)
        localStorage.setItem(
          "writer-classic.draft.document-recovered",
          JSON.stringify({ text: "recovered", path: null, savedText: "" }),
        );
      const bridge: any = {
        calls: [],
        disk: disk ?? "disk text",
        delayRead,
        menu(action: string) {
          callbacks.get(events.get("menu-action")!)?.({ payload: action });
        },
        async invoke(command: string, args: any) {
          this.calls.push({ command, args });
          if (command === "classic_font") throw "unavailable";
          if (command === "plugin:event|listen") {
            events.set(args.event, args.handler);
            return ++id;
          }
          if (command === "read_text" || command === "read_encoded") {
            if (this.delayRead) {
              this.delayRead = false;
              await new Promise((resolve) => {
                this.releaseRead = resolve;
              });
            }
            if (failRead) throw "disk unavailable";
            return this.disk;
          }
          if (command === "write_text" || command === "write_encoded") {
            if (this.delayNextWrite) {
              this.delayNextWrite = false;
              await new Promise((resolve) => {
                this.releaseWrite = resolve;
              });
            }
            this.disk = args.text;
          }
          if (command === "icloud_documents") return "/tmp/icloud/Documents";
          if (command === "plugin:window|get_all_windows") return [];
          if (command === "list_icloud")
            return ["/tmp/icloud/Documents/notes.md"];
          if (command === "choose_text_files")
            return { paths: ["/tmp/icloud/Documents/notes.md"], encoding: 12 };
          if (command === "plugin:dialog|save")
            return "/tmp/icloud/Documents/notes.md";
          if (command === "list_versions")
            return [
              { path: "/version", timestamp: 10, text: "previous version" },
            ];
          if (command === "browse_native_versions") return null;
          return null;
        },
      };
      Object.assign(window, {
        isTauri: true,
        testBridge: bridge,
        __TAURI_INTERNALS__: {
          metadata: { currentWindow: { label }, currentWebview: { label } },
          transformCallback(callback: (event: unknown) => void) {
            callbacks.set(++id, callback);
            return id;
          },
          invoke: (command: string, args: any) => bridge.invoke(command, args),
        },
      });
    },
    {
      label,
      draft: options.draft,
      disk: options.disk,
      failRead: options.failRead ?? false,
      vim: options.vim,
      delayRead: options.delayRead ?? false,
      recovered: options.recovered ?? false,
    },
  );
}

test("menu, quit, and preview listeners are bound to the current window", async ({
  page,
}) => {
  await install(page);
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) =>
            call.command === "plugin:event|listen" &&
            call.args.event === "quit-request",
        ),
      ),
    )
    .toBe(true);
  const targets = await page.evaluate(() =>
    (window as any).testBridge.calls
      .filter(
        (call: any) =>
          call.command === "plugin:event|listen" &&
          ["menu-action", "quit-request"].includes(call.args.event),
      )
      .map((call: any) => call.args.target),
  );
  expect(targets).toEqual([
    { kind: "WebviewWindow", label: "document-risk" },
    { kind: "WebviewWindow", label: "document-risk" },
  ]);
  await page.goto("/?preview=document-risk");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) =>
            call.args.event === "preview-update" &&
            call.args.target?.kind === "WebviewWindow",
        ),
      ),
    )
    .toBe(true);
});

test("persisted Vim off is pushed to the native checkbox at startup", async ({
  page,
}) => {
  await install(page, { vim: "false" });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).testBridge.calls.find(
            (call: any) => call.command === "set_vim_checked",
          )?.args.checked,
      ),
    )
    .toBe(false);
  await expect(page.getByLabel("Vim state")).toHaveCount(0);
});

test("chosen encoding is used for open and a later lossless save", async ({
  page,
}) => {
  await install(page);
  await page.goto("/");
  await page.evaluate(() => (window as any).testBridge.menu("open"));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) =>
            call.command === "read_encoded" && call.args.encoding === 12,
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("textbox", { name: "Document text" }).fill("café!");
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).testBridge.calls.some(
            (call: any) =>
              call.command === "write_encoded" &&
              call.args.encoding === 12 &&
              call.args.text === "café!",
          ),
        ),
      { timeout: 5000 },
    )
    .toBe(true);
});

test("iCloud browse, save, and move call the container workflow", async ({
  page,
}) => {
  await install(page, {
    draft: JSON.stringify({
      path: "/tmp/local.md",
      text: "local",
      savedText: "local",
    }),
  });
  await page.goto("/");
  await page.evaluate(() => (window as any).testBridge.menu("icloud-browse"));
  await expect(
    page.getByRole("dialog", { name: "iCloud documents" }),
  ).toContainText("notes.md");
  await page.evaluate(() => (window as any).testBridge.menu("icloud-save"));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) =>
            call.command === "write_text" &&
            call.args.path === "/tmp/icloud/Documents/notes.md",
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => (window as any).testBridge.menu("icloud-move"));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) => call.command === "move_to_icloud",
        ),
      ),
    )
    .toBe(true);
});

test("native version commands use the document browser and save semantics", async ({
  page,
}) => {
  await install(page, {
    draft: JSON.stringify({
      path: "/fixture/a.md",
      text: "opened",
      savedText: "opened",
    }),
    disk: "opened",
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Document text" })).toHaveText(
    "opened",
  );
  await page.evaluate(() => (window as any).testBridge.menu("versions"));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) =>
            call.command === "browse_native_versions" &&
            call.args.path === "/fixture/a.md" &&
            call.args.encoding === 4,
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("textbox", { name: "Document text" }).fill("edited");
  await page.evaluate(() => (window as any).testBridge.menu("last-opened"));
  await page.getByRole("button", { name: "Don’t Save" }).click();
  await expect(page.getByRole("textbox", { name: "Document text" })).toHaveText(
    "opened",
  );
  await page
    .getByRole("textbox", { name: "Document text" })
    .fill("edited again");
  await page.evaluate(() => (window as any).testBridge.menu("previous-save"));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) =>
            call.command === "list_versions" && call.args.encoding === 4,
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Don’t Save" }).click();
  await expect(page.getByRole("textbox", { name: "Document text" })).toHaveText(
    "previous version",
  );
});

test("dirty recovery is kept when the file on disk differs", async ({
  page,
}) => {
  await install(page, {
    draft: JSON.stringify({
      path: "/fixture/a.md",
      text: "unsaved draft",
      savedText: "old",
    }),
    disk: "external",
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Document text" })).toHaveText(
    "unsaved draft",
  );
  expect(
    await page.evaluate(() =>
      (window as any).testBridge.calls.some(
        (call: any) => call.command === "read_text",
      ),
    ),
  ).toBe(false);
});

test("a failed refresh of a clean recovery does not erase the draft", async ({
  page,
}) => {
  await install(page, {
    draft: JSON.stringify({
      path: "/fixture/a.md",
      text: "saved draft",
      savedText: "saved draft",
    }),
    failRead: true,
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Document text" })).toHaveText(
    "saved draft",
  );
  await expect(page.getByRole("alert")).toContainText("Could not refresh");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("writer-classic.draft.document-risk"),
    ),
  ).toContain("saved draft");
});

test("delayed clean recovery does not overwrite text typed during the disk read", async ({
  page,
}) => {
  await install(page, {
    draft: JSON.stringify({
      path: "/fixture/a.md",
      text: "saved draft",
      savedText: "saved draft",
    }),
    disk: "externally updated",
    delayRead: true,
  });
  const loaded = page.goto("/");
  await page.waitForFunction(() =>
    (window as any).testBridge.calls.some(
      (call: any) => call.command === "read_text",
    ),
  );
  const editor = page.getByRole("textbox", { name: "Document text" });
  await expect(editor).toHaveText("saved draft");
  await editor.fill("typed while reading");
  await page.evaluate(() => (window as any).testBridge.releaseRead());
  await loaded;
  await expect(editor).toHaveText("typed while reading");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("writer-classic.draft.document-risk") ||
              "null",
          )?.text,
      ),
    )
    .toBe("typed while reading");
});

test("an autosave skipped while a save is busy is rescheduled", async ({
  page,
}) => {
  await install(page, {
    draft: JSON.stringify({
      path: "/fixture/a.md",
      text: "saved draft",
      savedText: "saved draft",
    }),
    disk: "saved draft",
  });
  await page.goto("/");
  await page.waitForFunction(() =>
    (window as any).testBridge.calls.some(
      (call: any) =>
        call.command === "plugin:event|listen" &&
        call.args.event === "menu-action",
    ),
  );
  const editor = page.getByRole("textbox", { name: "Document text" });
  await expect(editor).toHaveText("saved draft");
  await editor.fill("first edit");
  await page.evaluate(() => {
    (window as any).testBridge.delayNextWrite = true;
  });
  await page.keyboard.press("Meta+s");
  await page.waitForFunction(() =>
    (window as any).testBridge.calls.some(
      (call: any) => call.command === "write_text",
    ),
  );
  await editor.fill("second edit");
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window as any).testBridge.releaseWrite());
  await expect
    .poll(() => page.evaluate(() => (window as any).testBridge.disk), {
      timeout: 6000,
    })
    .toBe("second edit");
});

test("empty documents are registered and closed documents leave the scripting registry", async ({
  page,
}) => {
  await install(page);
  await page.goto("/");
  await page.waitForFunction(() =>
    (window as any).testBridge.calls.some(
      (call: any) =>
        call.command === "plugin:event|listen" &&
        call.args.event === "menu-action",
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) =>
            call.command === "script_note_document" && call.args.text === "",
        ),
      ),
    )
    .toBe(true);
  await page.keyboard.press("Meta+w");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) => call.command === "script_forget_document",
        ),
      ),
    )
    .toBe(true);
});

test("new and recovered document windows stay hidden until the header is set", async ({
  page,
}) => {
  await install(page, { label: "main", recovered: true });
  await page.goto("/");
  await page.waitForFunction(() =>
    (window as any).testBridge.calls.some(
      (call: any) =>
        call.command === "plugin:webview|create_webview_window" &&
        call.args.options?.label === "document-recovered",
    ),
  );
  await page.waitForFunction(() =>
    (window as any).testBridge.calls.some(
      (call: any) =>
        call.command === "plugin:event|listen" &&
        call.args.event === "menu-action",
    ),
  );
  const beforeNew = await page.evaluate(() => {
    const calls = (window as any).testBridge.calls;
    const header = calls.findIndex(
      (call: any) => call.command === "set_document_header",
    );
    const shown = calls.findIndex(
      (call: any) => call.command === "plugin:window|show",
    );
    return {
      header,
      shown,
      recovered: calls.find(
        (call: any) =>
          call.command === "plugin:webview|create_webview_window" &&
          call.args.options?.label === "document-recovered",
      )?.args.options.visible,
    };
  });
  expect(beforeNew.header).toBeGreaterThanOrEqual(0);
  expect(beforeNew.shown).toBeGreaterThan(beforeNew.header);
  expect(beforeNew.recovered).toBe(false);
  await page.keyboard.press("Meta+n");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testBridge.calls.some(
          (call: any) =>
            call.command === "plugin:webview|create_webview_window" &&
            call.args.options?.visible === false &&
            call.args.options?.label !== "document-recovered",
        ),
      ),
    )
    .toBe(true);
});
