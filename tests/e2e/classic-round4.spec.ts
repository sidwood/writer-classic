import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Document text" });
const findBar = (page: Page) => page.locator(".cm-search");

async function opacity(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    let value = 1;
    for (let e: Element | null = element; e; e = e.parentElement)
      value *= Number(getComputedStyle(e).opacity);
    return value;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("Classic find bar counts, ignores case, closes with Done, and replaces all", async ({
  page,
}) => {
  await editor(page).fill("Alpha beta alpha. ALPHA gamma.");
  await page.keyboard.press("Meta+f");
  const find = page.getByRole("textbox", { name: "Find", exact: true });
  await expect(find).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Replace with" }),
  ).toBeHidden();
  await find.fill("alpha");
  const count = page.getByRole("status", { name: "Matches" });
  await expect(count).toHaveText("3 matches");
  await find.press("Enter");
  await expect(count).toHaveText("1 of 3");
  const current = page.locator(".cm-searchMatch-selected");
  await expect(current).toHaveText("Alpha");
  await expect(current).toHaveCSS("background-color", "rgb(255, 230, 0)");
  await page.getByRole("button", { name: "Next match" }).click();
  await expect(count).toHaveText("2 of 3");
  await page.mouse.move(430, 320);
  expect(await opacity(page, ".statistics")).toBe(1);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(findBar(page)).toHaveCount(0);

  await page.keyboard.press("Meta+Alt+f");
  await expect(page.getByRole("checkbox", { name: "Replace" })).toBeChecked();
  await page.getByRole("textbox", { name: "Replace with" }).fill("omega");
  await page.getByRole("button", { name: "Replace All" }).click();
  await expect(editor(page)).toHaveText("omega beta omega. omega gamma.");
  await expect(count).toHaveText("0 matches");
});

test("find options stay exclusive and Insert Pattern fills the focused field", async ({
  page,
}) => {
  await editor(page).fill(
    "Mail ada@example.com or bo@example.org. catalog cat",
  );
  await page.keyboard.press("Meta+f");
  await page.getByText("Options").click();
  await expect(
    page.getByRole("checkbox", { name: "Ignore Case" }),
  ).toBeChecked();
  await expect(page.getByRole("radio", { name: "Contains" })).toBeChecked();
  const find = page.getByRole("textbox", { name: "Find", exact: true });
  await find.fill("cat");
  const count = page.getByRole("status", { name: "Matches" });
  await expect(count).toHaveText("2 matches");
  await page.getByRole("radio", { name: "Full Word" }).check();
  await expect(page.getByRole("radio", { name: "Contains" })).not.toBeChecked();
  await expect(count).toHaveText("1 match");
  await page.getByRole("radio", { name: "Starts With" }).check();
  await expect(
    page.getByRole("radio", { name: "Full Word" }),
  ).not.toBeChecked();
  await expect(count).toHaveText("2 matches");
  await page.getByRole("radio", { name: "Contains" }).check();
  await find.fill("");
  await find.focus();
  await page
    .getByRole("combobox", { name: "Insert Pattern" })
    .selectOption({ label: "Email Address" });
  await expect(find).toHaveValue("‹email›");
  await expect(find).toBeFocused();
  await expect(count).toHaveText("2 matches");
  await page
    .getByRole("combobox", { name: "Insert Pattern" })
    .selectOption({ label: "Tab" });
  await expect(find).toHaveValue("‹email›\t");
});

test("Auto Markdown markers take the style of the text they format", async ({
  page,
}) => {
  await editor(page).fill("# Head\n\n*em* and **strong**\n\n* item");
  const styleAt = (line: number, offset: number) =>
    page
      .locator(".cm-line")
      .nth(line)
      .evaluate((element, offset) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let seen = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const length = node.textContent!.length;
          if (offset < seen + length) {
            const style = getComputedStyle(node.parentElement!);
            return {
              color: style.color,
              fontStyle: style.fontStyle,
              fontWeight: style.fontWeight,
              fontSize: style.fontSize,
            };
          }
          seen += length;
        }
        return null;
      }, offset);
  const body = await styleAt(2, 5);
  expect(body?.fontStyle).toBe("normal");
  expect(await styleAt(2, 0)).toEqual({ ...(await styleAt(2, 1)) });
  expect((await styleAt(2, 0))?.fontStyle).toBe("italic");
  expect((await styleAt(2, 0))?.color).toBe(body?.color);
  expect(await styleAt(2, 9)).toEqual(await styleAt(2, 11));
  expect(Number((await styleAt(2, 9))?.fontWeight)).toBeGreaterThanOrEqual(700);
  expect((await styleAt(2, 9))?.color).toBe(body?.color);
  const hash = await styleAt(0, 0);
  expect(hash).toEqual(await styleAt(0, 2));
  expect(Number(hash?.fontWeight)).toBeGreaterThanOrEqual(700);
  expect(hash?.fontSize).toBe(body?.fontSize);
  expect(await styleAt(4, 0)).toEqual(body);
});

test("statistics pause, View labels toggle, format bar and Classic commands", async ({
  page,
}) => {
  const statistics = page.getByLabel("Document statistics");
  await editor(page).fill("one two three");
  await expect(statistics).toContainText("0 W");
  await expect(statistics).toContainText("3 W", { timeout: 6000 });

  await expect(page.getByRole("button", { name: "Emphasis" })).toHaveText("/");
  await expect(page.getByRole("button", { name: "Emphasis" })).toHaveAttribute(
    "title",
    "Emphasis (⌘I)",
  );

  const view = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "View" }) });
  await view.locator("summary").click();
  await expect(view.getByRole("button", { name: /Focus Mode/ })).toContainText(
    "Enter Focus Mode",
  );
  await expect(view.getByRole("button", { name: /Format Bar/ })).toContainText(
    "Hide Format Bar",
  );
  await view.getByRole("button", { name: /Focus Mode/ }).click();
  await expect(view.getByRole("button", { name: /Focus Mode/ })).toContainText(
    "Exit Focus Mode",
  );
  await view.getByRole("button", { name: /Format Bar/ }).click();
  await expect(view.getByRole("button", { name: /Format Bar/ })).toContainText(
    "Show Format Bar",
  );
  await expect(view.getByRole("button", { name: /Preview/ })).toContainText(
    "Show Preview",
  );
  await view.evaluate((element) => element.removeAttribute("open"));

  await editor(page).click();
  await page.keyboard.press("Control+Meta+d");
  await expect(page.locator(".focus-switch")).toHaveText("Focus On");

  const file = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "File" }) });
  await file.locator("summary").click();
  await file.getByRole("button", { name: /Close All/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Save changes");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(editor(page)).toHaveText("one two three");
});
