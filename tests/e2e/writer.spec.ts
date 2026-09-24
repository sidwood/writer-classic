import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { Document, Paragraph, Packer, TextRun } from "docx";

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Document text" });
async function menu(page: Page, name: string, item: string) {
  const details = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: name }) });
  if (!(await details.getAttribute("open")))
    await details.locator("summary").click();
  await details.getByRole("button", { name: item, exact: false }).click();
  await page
    .locator("details")
    .evaluateAll((elements) =>
      elements.forEach((element) => element.removeAttribute("open")),
    );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("raw document open/save preserves BOM, CRLF, duplicates, Unicode, whitespace and empty files", async ({
  page,
}) => {
  const text = "\ufeff  café\r\n\r\n猫\t\nrepeat\nrepeat\n";
  await page.locator("input[type=file]").setInputFiles({
    name: "unusual name.md",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  await expect(page).toHaveTitle("unusual name.md");
  const download = page.waitForEvent("download");
  await page.keyboard.press("Meta+s");
  const saved = await download;
  expect(await readFile((await saved.path())!, "utf8")).toBe(text);
  await page.locator("input[type=file]").setInputFiles({
    name: "empty.md",
    mimeType: "text/plain",
    buffer: Buffer.from(""),
  });
  await expect(editor(page)).toHaveText("");
});

test("draft recovery and save/discard/cancel transitions protect edits", async ({
  page,
}) => {
  await editor(page).fill("Keep this draft.");
  await page.reload();
  await expect(editor(page)).toHaveText("Keep this draft.");
  await page.keyboard.press("Meta+n");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.type("iLEAK");
  await expect(editor(page)).toHaveText("Keep this draft.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor(page)).toHaveText("Keep this draft.");
  await page.keyboard.press("Meta+n");
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  expect(await readFile((await (await download).path())!, "utf8")).toBe(
    "Keep this draft.",
  );
  await expect(editor(page)).toHaveText("");
  await editor(page).fill("Discard only this.");
  await page.keyboard.press("Meta+n");
  await page.getByRole("button", { name: "Don’t Save" }).click();
  await expect(editor(page)).toHaveText("");
});

test("real Vim normal/insert/visual, operators, undo, search and Ex save work", async ({
  page,
}) => {
  await editor(page).fill("alpha beta\ngamma delta");
  await editor(page).click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("gg0dw");
  await expect(editor(page).locator(".cm-line")).toHaveText([
    "beta",
    "gamma delta",
  ]);
  await page.keyboard.type("u");
  await expect(editor(page).locator(".cm-line")).toHaveText([
    "alpha beta",
    "gamma delta",
  ]);
  await page.keyboard.type("gg0iHello ");
  await page.keyboard.press("Escape");
  await expect(editor(page).locator(".cm-line")).toHaveText([
    "Hello alpha beta",
    "gamma delta",
  ]);
  await page.keyboard.type("gg0vll");
  await expect(page.getByLabel("Vim state")).toHaveText("VISUAL");
  await page.keyboard.press("Escape");
  await page.keyboard.type("/delta");
  await page.keyboard.press("Enter");
  await page.keyboard.type("ciwomega");
  await page.keyboard.press("Escape");
  await expect(editor(page).locator(".cm-line")).toHaveText([
    "Hello alpha beta",
    "gamma omega",
  ]);
  const download = page.waitForEvent("download");
  await page.keyboard.type(":w");
  await page.keyboard.press("Enter");
  expect(await readFile((await (await download).path())!, "utf8")).toBe(
    "Hello alpha beta\ngamma omega",
  );
});

test("dark mode persists; sentence focus, statistics, preview and formatting remain usable", async ({
  page,
}) => {
  await editor(page).fill("First sentence. Second sentence.");
  await page.keyboard.press("Meta+Alt+d");
  await expect(page.locator("html")).toHaveClass("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveClass("dark");
  await editor(page).click();
  await page.keyboard.press("Meta+Home");
  await page.keyboard.press("Meta+d");
  await expect(page.locator(".unfocused-sentence")).toContainText(
    "Second sentence.",
  );
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+b");
  await expect(editor(page)).toContainText(
    "**First sentence. Second sentence.**",
  );
  await expect(page.getByLabel("Document statistics")).toContainText("4 W");
  const popupPromise = page.waitForEvent("popup");
  await page.keyboard.press("Meta+r");
  const popup = await popupPromise;
  await expect(popup.locator("strong")).toHaveText(
    "First sentence. Second sentence.",
  );
  await expect(popup.locator("body")).toHaveClass(/dark/);
  await popup.close();
});

test("find/replace, export HTML, RTF and DOCX, then import DOCX", async ({
  page,
}) => {
  await editor(page).fill("# Notes\n\nA **strong** word.");
  await page.keyboard.press("Meta+f");
  await page.getByRole("textbox", { name: "Find", exact: true }).fill("word");
  await page
    .getByRole("textbox", { name: "Replace", exact: true })
    .fill("sentence");
  await page.getByRole("button", { name: "replace all", exact: true }).click();
  await expect(editor(page)).toContainText("sentence");
  let docxPath = "";
  for (const type of ["html", "rtf", "docx"]) {
    await menu(page, "File", "Export…");
    await page.getByRole("combobox").selectOption(type);
    const download = page.waitForEvent("download");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Export", exact: true })
      .click();
    const path = (await (await download).path())!;
    if (type === "html")
      expect(await readFile(path, "utf8")).toContain("<strong>strong</strong>");
    if (type === "rtf")
      expect(await readFile(path, "utf8")).toContain("\\b strong");
    if (type === "docx") {
      expect((await readFile(path)).subarray(0, 2).toString()).toBe("PK");
      docxPath = path;
    }
  }
  await page.locator("input[type=file]").setInputFiles({
    name: "import.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await readFile(docxPath),
  });
  await expect(editor(page)).toContainText("# Notes");
  await expect(editor(page)).toContainText("**strong**");
});

test("RTF export retains numbered lists and hyperlinks", async ({ page }) => {
  await editor(page).fill("1. One\n2. Two\n\n[site](https://example.test)");
  await menu(page, "File", "Export…");
  await page.getByRole("combobox").selectOption("rtf");
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Export", exact: true })
    .click();
  const rtf = await readFile((await (await download).path())!, "utf8");
  expect(rtf).toContain("1.\\tab One");
  expect(rtf).toContain("2.\\tab Two");
  expect(rtf).toContain('HYPERLINK "https://example.test"');
});

test("Classic DOCX conversion preserves image alt text, code style and imported underline", async ({
  page,
}) => {
  await editor(page).fill(
    "`code` and ![description](https://example.test/image.png)",
  );
  await menu(page, "File", "Export…");
  await page.getByRole("combobox").selectOption("docx");
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Export", exact: true })
    .click();
  const zip = await JSZip.loadAsync(
    await readFile((await (await download).path())!),
  );
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("[description]");
  expect(xml).toContain('w:rStyle w:val="Code"');
  const input = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [new TextRun({ text: "underlined", underline: {} })],
            }),
          ],
        },
      ],
    }),
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "underlined.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: input,
  });
  await expect(editor(page)).toHaveText("*underlined*");
});
