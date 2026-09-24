import MarkdownIt from "markdown-it/dist/index.cjs.js";
import footnote from "markdown-it-footnote";

const parser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
}).use(footnote);
// Classic separates paragraphs with one return. Split block tokens before
// inline parsing so emphasis never generates tags across paragraph boundaries.
parser.core.ruler.before("inline", "classic_paragraphs", (state) => {
  const result = [];
  for (let index = 0; index < state.tokens.length; index++) {
    const token = state.tokens[index];
    const inline = state.tokens[index + 1];
    if (
      token.type !== "paragraph_open" ||
      inline?.type !== "inline" ||
      !inline.content.includes("\n")
    ) {
      result.push(token);
      continue;
    }
    for (const line of inline.content.split("\n")) {
      const open = new state.Token("paragraph_open", "p", 1);
      open.block = true;
      const content = new state.Token("inline", "", 0);
      content.content = line;
      content.children = [];
      const close = new state.Token("paragraph_close", "p", -1);
      close.block = true;
      result.push(open, content, close);
    }
    index += 2;
  }
  state.tokens = result;
});

export function renderMarkdown(source: string) {
  let fence: { delimiter: string; length: number } | null = null;
  const prepared = source
    .split("\n")
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence.delimiter &&
          marker[1].length >= fence.length &&
          /^\s*$/.test(marker[2])
        )
          fence = null;
        return line;
      }
      if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
        fence = { delimiter: marker[1][0], length: marker[1].length };
        return line;
      }
      const bullet = line.match(/^(\*{2,}) (.*)$/);
      if (bullet) return `${"  ".repeat(bullet[1].length - 1)}* ${bullet[2]}`;
      const ordered = line.match(/^(\d+(?:\.\d+)+)\. (.*)$/);
      if (ordered)
        return `${"   ".repeat(ordered[1].split(".").length - 1)}1. ${ordered[2]}`;
      return line;
    })
    .join("\n");
  return parser.render(prepared);
}

export function htmlDocument(text: string, title: string) {
  const escaped = title.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escaped}</title></head><body>${renderMarkdown(text)}</body></html>`;
}
