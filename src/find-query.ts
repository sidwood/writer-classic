export type FindMatch = "contains" | "starts-with" | "full-word";
export type FindOptions = {
  ignoreCase: boolean;
  wrapAround: boolean;
  match: FindMatch;
};
export const defaultFindOptions: FindOptions = {
  ignoreCase: true,
  wrapAround: true,
  match: "contains",
};
/** Visible placeholder that Insert Pattern puts in a field for any email address. */
export const EMAIL_PATTERN = "‹email›";
const EMAIL_EXPRESSION = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";

function escapeExpression(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Converts the find bar fields and options into a CodeMirror SearchQuery spec. */
export function findQuerySpec(
  find: string,
  replace: string,
  options: FindOptions,
) {
  const regexp =
    options.match === "starts-with" ||
    find.includes(EMAIL_PATTERN) ||
    replace.includes(EMAIL_PATTERN);
  const search = regexp
    ? (options.match === "starts-with" ? "\\b" : "") +
      find.split(EMAIL_PATTERN).map(escapeExpression).join(EMAIL_EXPRESSION)
    : find;
  return {
    search,
    replace: regexp
      ? replace.replace(/\$/g, "$$$$").split(EMAIL_PATTERN).join("$&")
      : replace,
    caseSensitive: !options.ignoreCase,
    regexp,
    wholeWord: options.match === "full-word",
    literal: true,
  };
}
