import { expect, test } from "vitest";
import {
  classicType,
  contentSizeForWidth,
  textMeasure,
} from "../src/adaptive-layout";

test("window width selects Classic content sizes at 850 and 1065", () => {
  expect(contentSizeForWidth(560)).toBe(1);
  expect(contentSizeForWidth(849)).toBe(1);
  expect(contentSizeForWidth(850)).toBe(2);
  expect(contentSizeForWidth(1064)).toBe(2);
  expect(contentSizeForWidth(1065)).toBe(3);
  expect(contentSizeForWidth(2560)).toBe(3);
});

test("Nitti Pro sizes and line heights follow the Classic table", () => {
  expect(classicType(849)).toEqual({
    size: 1,
    fontSize: 16,
    lineHeight: 23.6026,
  });
  expect(classicType(860)).toEqual({
    size: 2,
    fontSize: 19,
    lineHeight: 27.854,
  });
  expect(classicType(1065)).toEqual({
    size: 3,
    fontSize: 24,
    lineHeight: 33.718,
  });
});

test("text measure is ceil(glyph × 80 + 11)", () => {
  expect(textMeasure(10)).toBe(811);
  expect(textMeasure(11.5)).toBe(931);
  expect(textMeasure(9.6328125)).toBe(782);
});
