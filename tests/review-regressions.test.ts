import { expect, test } from "vitest";
import { marksAt } from "../src/format-marks";
import { renderMarkdown } from "../src/markdown";
test("mixed delimiters and short fences preserve literal code", () => {
  expect(renderMarkdown("```\n~~~\n** literal\n```\n** child")).toBe(
    "<pre><code>~~~\n** literal\n</code></pre>\n<ul>\n<li>child</li>\n</ul>\n",
  );
  expect(renderMarkdown("````\n```\n** literal\n````")).toBe(
    "<pre><code>```\n** literal\n</code></pre>\n",
  );
  expect(renderMarkdown("~~~\n```\n** literal\n~~~\n** child")).toBe(
    "<pre><code>```\n** literal\n</code></pre>\n<ul>\n<li>child</li>\n</ul>\n",
  );
  expect(renderMarkdown("```js\n** literal\n```")).toBe(
    '<pre><code class="language-js">** literal\n</code></pre>\n',
  );
});
test("caret in heading text keeps that heading active", () => {
  const heading = "# Heading text";
  expect(marksAt(heading, heading.indexOf("Heading")).heading).toBe(1);
  expect(marksAt("## Second", 4).heading).toBe(2);
  expect(marksAt("plain", 1).heading).toBe(0);
  expect(marksAt("**bold**", 3).bold).toBe(true);
  expect(marksAt("_em_", 2).italic).toBe(true);
  expect(marksAt("~~gone~~", 3).strike).toBe(true);
});
