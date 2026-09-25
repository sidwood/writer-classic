import { expect, test } from "vitest";
import {
  EMAIL_PATTERN,
  FIND_PATTERNS,
  defaultFindOptions,
  findQuerySpec,
} from "../src/find-query";

const token = (label: string) =>
  FIND_PATTERNS.find((pattern) => pattern.label === label)!.token;
function replaced(text: string, find: string, replace: string) {
  const spec = findQuerySpec(find, replace, defaultFindOptions);
  return text.replace(new RegExp(spec.search, "gi"), spec.replace);
}

test("find defaults to a literal, case-insensitive contains search", () => {
  expect(defaultFindOptions.ignoreCase).toBe(true);
  expect(defaultFindOptions.match).toBe("contains");
  expect(findQuerySpec("a.b", "x$1", defaultFindOptions)).toEqual({
    search: "a.b",
    replace: "x$1",
    caseSensitive: false,
    regexp: false,
    wholeWord: false,
    literal: true,
  });
});

test("starts with, full word, and case options shape the query", () => {
  const starts = findQuerySpec("a.b", "$", {
    ...defaultFindOptions,
    match: "starts-with",
  });
  expect(starts.search).toBe("\\ba\\.b");
  expect(starts.regexp).toBe(true);
  expect(starts.replace).toBe("$$");
  expect(starts.wholeWord).toBe(false);
  const word = findQuerySpec("cat", "", {
    ...defaultFindOptions,
    ignoreCase: false,
    match: "full-word",
  });
  expect(word).toMatchObject({
    search: "cat",
    regexp: false,
    wholeWord: true,
    caseSensitive: true,
  });
});

test("email pattern matches addresses and replaces with the address", () => {
  const spec = findQuerySpec(
    `mail ${EMAIL_PATTERN}`,
    `<${EMAIL_PATTERN}>`,
    defaultFindOptions,
  );
  expect(spec.regexp).toBe(true);
  expect(spec.replace).toBe("<$1>");
  expect(
    replaced(
      "Mail ada@example.com now",
      `mail ${EMAIL_PATTERN}`,
      `<${EMAIL_PATTERN}>`,
    ),
  ).toBe("<ada@example.com> now");
  const expression = new RegExp(spec.search, "i");
  expect("Mail ada@example.com now".match(expression)?.[0]).toBe(
    "Mail ada@example.com",
  );
  expect(expression.test("mail nobody")).toBe(false);
});

test("tab stays a literal tab character", () => {
  expect(findQuerySpec("a\tb", "", defaultFindOptions).search).toBe("a\tb");
});

test("Insert Pattern offers the macOS find bar patterns", () => {
  expect(FIND_PATTERNS.map((pattern) => pattern.label)).toEqual([
    "Any Characters",
    "Any Word Characters",
    "Word Break",
    "White Space",
    "Digits",
    "Line Break",
    "Paragraph Break",
    "Email Address",
    "Web Address",
    "Phone Number",
  ]);
});

test("line break finds and inserts a break", () => {
  expect(replaced("one\ntwo\r\nthree", `${token("Line Break")}`, " / ")).toBe(
    "one / two / three",
  );
  expect(replaced("a, b", `, `, token("Line Break"))).toBe("a\nb");
});

test("any characters matches lazily between literal text", () => {
  expect(replaced("[a] and [bc]", `[${token("Any Characters")}]`, "<>")).toBe(
    "<> and <>",
  );
});

test("web address finds URLs and Replace reuses the match", () => {
  expect(
    replaced(
      "see https://example.com/a?b=1 now",
      token("Web Address"),
      `<${token("Web Address")}>`,
    ),
  ).toBe("see <https://example.com/a?b=1> now");
  expect(replaced("no address here", token("Web Address"), "x")).toBe(
    "no address here",
  );
});

test("repeated tokens refer back to their own occurrences", () => {
  const digits = token("Digits");
  expect(
    replaced("2026-09", `${digits}-${digits}`, `${digits}/${digits}`),
  ).toBe("2026/09");
  expect(replaced("a  b\tc", token("White Space"), "_")).toBe("a_b_c");
  expect(
    replaced(
      "cat catalog",
      `${token("Word Break")}cat${token("Word Break")}`,
      "dog",
    ),
  ).toBe("dog catalog");
});
