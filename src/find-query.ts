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
/**
 * Insert Pattern entries. Classic's find bar is the macOS NSTextFinder bar, whose
 * patterns come from AppKit's NSBasicPatterns, NSCharacterPatterns and
 * NSAdvancedPatterns lists. Tab is inserted as a literal tab. The others insert a
 * visible token; a token in Replace stands for the text its find token matched
 * (the same-numbered occurrence), and break tokens insert the break itself.
 * Page Break has no plain-text expression in AppKit and is not offered.
 */
export type FindPattern = {
  label: string;
  token: string;
  expression: string;
  /** Inserted by the token in Replace instead of the matched text. */
  replacement?: string;
};
const LINE_BREAK = "\\r\\n|\\r|\\n|[\\u0085\\u2028\\u2029]";
export const FIND_PATTERNS: FindPattern[] = [
  { label: "Any Characters", token: "‹any›", expression: ".+?" },
  { label: "Any Word Characters", token: "‹word›", expression: "\\w+" },
  {
    label: "Word Break",
    token: "‹word break›",
    expression: "\\b",
    replacement: "",
  },
  { label: "White Space", token: "‹space›", expression: "\\s+" },
  { label: "Digits", token: "‹digits›", expression: "\\d+" },
  {
    label: "Line Break",
    token: "‹line break›",
    expression: LINE_BREAK,
    replacement: "\n",
  },
  {
    label: "Paragraph Break",
    token: "‹paragraph break›",
    expression: "\\r\\n|\\r|\\n|\\u2029",
    replacement: "\n",
  },
  {
    label: "Email Address",
    token: "‹email›",
    expression: "\\b[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,63}\\b",
  },
  {
    label: "Web Address",
    token: "‹url›",
    expression:
      "(?:[A-Za-z][A-Za-z0-9+.-]{1,120}:[A-Za-z0-9/](?:[A-Za-z0-9$_.+!*,;/?:@&~=-]|%[A-Fa-f0-9]{2}){1,333}(?:#[a-zA-Z0-9][a-zA-Z0-9$_.+!*,;/?:@&~=%-]{0,1000})?)",
  },
  {
    label: "Phone Number",
    token: "‹phone›",
    expression:
      "(?:(?:\\+?1\\s*(?:[.-]\\s*)?)?(?:\\(\\s*(?:[2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9])\\s*\\)|(?:[2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9]))\\s*(?:[.-]\\s*)?)?(?:[2-9]1[02-9]|[2-9][02-9]1|[2-9][02-9]{2})\\s*(?:[.-]\\s*)?(?:[0-9]{4})(?:\\s*(?:#|x\\.?|ext\\.?|extension)\\s*(?:\\d+))?",
  },
];
export const EMAIL_PATTERN = "‹email›";

function escapeExpression(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TOKENS = new RegExp(
  FIND_PATTERNS.map((pattern) => escapeExpression(pattern.token)).join("|"),
  "g",
);
const byToken = new Map(
  FIND_PATTERNS.map((pattern) => [pattern.token, pattern]),
);

function hasToken(text: string) {
  return text.search(TOKENS) >= 0;
}

/** Converts the find bar fields and options into a CodeMirror SearchQuery spec. */
export function findQuerySpec(
  find: string,
  replace: string,
  options: FindOptions,
) {
  const regexp =
    options.match === "starts-with" || hasToken(find) || hasToken(replace);
  if (!regexp)
    return {
      search: find,
      replace,
      caseSensitive: !options.ignoreCase,
      regexp,
      wholeWord: options.match === "full-word",
      literal: true,
    };
  // Each find token is a numbered group, so Replace can refer back to it.
  const groups = new Map<string, number[]>();
  let group = 0;
  let search = "";
  let last = 0;
  for (const match of find.matchAll(TOKENS)) {
    const pattern = byToken.get(match[0])!;
    search += escapeExpression(find.slice(last, match.index));
    search += `(${pattern.expression})`;
    groups.set(pattern.token, [...(groups.get(pattern.token) ?? []), ++group]);
    last = match.index! + match[0].length;
  }
  search += escapeExpression(find.slice(last));
  const seen = new Map<string, number>();
  const replacement = replace
    .replace(/\$/g, "$$$$")
    .replace(TOKENS, (token) => {
      const pattern = byToken.get(token)!;
      const numbers = groups.get(token);
      if (!numbers) return pattern.replacement ?? "";
      const index = seen.get(token) ?? 0;
      seen.set(token, index + 1);
      return `$${numbers[Math.min(index, numbers.length - 1)]}`;
    });
  return {
    search: (options.match === "starts-with" ? "\\b" : "") + search,
    replace: replacement,
    caseSensitive: !options.ignoreCase,
    regexp,
    wholeWord: options.match === "full-word",
    literal: true,
  };
}
