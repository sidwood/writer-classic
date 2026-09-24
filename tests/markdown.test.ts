import { expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown";
it("renders Classic single-return paragraphs, nested shorthand and footnotes without changing source", () => {
  expect(renderMarkdown("First\nSecond")).toBe("<p>First</p>\n<p>Second</p>\n");
  const html = renderMarkdown("* One\n** Two\n\nA note[^1].\n\n[^1]: Footnote");
  expect(html).toContain("<ul>\n<li>One\n<ul>\n<li>Two</li>");
  expect(html).toContain("Footnote");
});
it("does not activate arbitrary HTML or javascript links", () => {
  expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
  expect(renderMarkdown("[bad](javascript:alert(1))")).not.toContain(
    'href="javascript:',
  );
});
it("keeps paragraph boundaries outside inline emphasis and nested lists", () => {
  expect(renderMarkdown("*first\nsecond*")).toBe(
    "<p>*first</p>\n<p>second*</p>\n",
  );
  expect(renderMarkdown("* one\n  continuation")).toBe(
    "<ul>\n<li>\n<p>one</p>\n<p>continuation</p>\n</li>\n</ul>\n",
  );
});
