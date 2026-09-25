import { expect, test } from "./support/fresh-storage";

test("Vim defaults on, lives only in Edit as a checkbox, and explicit off survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Vim state")).toHaveText("NORMAL");
  const edit = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Edit" }) });
  const view = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "View" }) });
  await edit.locator("summary").click();
  const toggle = edit.getByRole("menuitemcheckbox", { name: "Vim Mode" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(
    view.getByRole("menuitemcheckbox", { name: "Vim Mode" }),
  ).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(page.getByLabel("Vim state")).toHaveCount(0);
  await edit.locator("summary").click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByLabel("Vim state")).toHaveText("NORMAL");
  await page.reload();
  await expect(page.getByLabel("Vim state")).toHaveText("NORMAL");
});

const modes = [
  {
    key: "v",
    indicator: "VISUAL",
    extend: "l",
    deleted: ["c", "def", "ghi"],
    changed: ["Xc", "def", "ghi"],
    pasted: ["ababc", "def", "ghi"],
  },
  {
    key: "V",
    indicator: "VISUAL LINE",
    extend: "",
    deleted: ["def", "ghi"],
    changed: ["X", "def", "ghi"],
    pasted: ["abc", "abc", "def", "ghi"],
  },
  {
    key: "Control+v",
    indicator: "VISUAL BLOCK",
    extend: "jl",
    deleted: ["c", "f", "ghi"],
    changed: ["Xc", "Xf", "ghi"],
    pasted: ["ababc", "dedef", "ghi"],
  },
];
for (const mode of modes) {
  for (const operator of ["y", "c", "d"]) {
    test(`${mode.indicator}: ${operator} and undo preserve proper selection shape`, async ({
      page,
    }) => {
      await page.goto("/");
      const editor = page.getByRole("textbox", { name: "Document text" });
      await editor.fill("abc\ndef\nghi");
      await editor.click();
      await page.keyboard.press("Escape");
      await page.keyboard.type("gg0");
      await page.keyboard.press(mode.key);
      await page.keyboard.type(mode.extend);
      await expect(page.getByLabel("Vim state")).toHaveText(mode.indicator);
      await page.keyboard.type(operator);
      if (operator === "c") {
        await page.keyboard.type("X");
        await page.keyboard.press("Escape");
      }
      if (operator === "y") {
        await page.keyboard.type("gg0P");
      }
      await expect(editor.locator(".cm-line")).toHaveText(
        operator === "c"
          ? mode.changed
          : operator === "d"
            ? mode.deleted
            : mode.pasted,
      );
      await page.keyboard.type("u");
      await expect(editor.locator(".cm-line")).toHaveText([
        "abc",
        "def",
        "ghi",
      ]);
    });
  }
}
