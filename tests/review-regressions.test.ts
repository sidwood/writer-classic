import { expect, test } from "vitest";
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
