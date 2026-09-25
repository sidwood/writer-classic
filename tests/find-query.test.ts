import { expect, test } from "vitest";
import {
  EMAIL_PATTERN,
  defaultFindOptions,
  findQuerySpec,
} from "../src/find-query";

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

test("email pattern matches addresses and replaces with the match", () => {
  const spec = findQuerySpec(
    `mail ${EMAIL_PATTERN}`,
    `<${EMAIL_PATTERN}>`,
    defaultFindOptions,
  );
  expect(spec.regexp).toBe(true);
  expect(spec.replace).toBe("<$&>");
  const expression = new RegExp(spec.search, "i");
  expect("Mail ada@example.com now".match(expression)?.[0]).toBe(
    "Mail ada@example.com",
  );
  expect(expression.test("mail nobody")).toBe(false);
});

test("tab stays a literal tab character", () => {
  expect(findQuerySpec("a\tb", "", defaultFindOptions).search).toBe("a\tb");
});
