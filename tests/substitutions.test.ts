import { expect, test } from "vitest";
import {
  detectText,
  detectionTarget,
  smartDeleteBounds,
  smartInserted,
} from "../src/substitutions";

test("smart copy/paste separates words and removes the leftover space", () => {
  expect(smartInserted("o", "w", "x")).toBe(" x ");
  expect(smartInserted(" ", "w", "world")).toBe("world ");
  expect(smartInserted("o", "", "world")).toBe(" world");
  expect(smartDeleteBounds("hello world there", 6, 11)).toEqual([6, 12]);
  expect(smartDeleteBounds("hello world", 6, 11)).toEqual([5, 11]);
  expect(smartDeleteBounds("hello", 0, 5)).toEqual([0, 5]);
});

test("smart links and data detection mark actionable text", () => {
  const text =
    "See https://example.com/notes and call 415-555-0134 on 2024-03-15 at 1 Market Street.";
  const links = detectText(text, true, false);
  expect(links.map((item) => item.kind)).toEqual(["link"]);
  expect(detectionTarget(links[0])).toBe("https://example.com/notes");
  const data = detectText(text, false, true);
  expect(data.map((item) => item.kind)).toEqual(["phone", "date", "address"]);
  expect(detectionTarget(data[0])).toBe("tel:4155550134");
  expect(detectionTarget(data[1])).toBeNull();
  expect(detectText(text, false, false)).toEqual([]);
});
