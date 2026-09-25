import { expect, test } from "vitest";
import {
  classicLayout,
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

test("Classic's default 735-point window puts 16px text 14px in and 22px down", () => {
  // container ceil(16 × 0.54 × 80 + 11) = 703, inset ceil((735 − 703 − 15) / 2) = 9.
  expect(classicLayout(735)).toMatchObject({
    fontSize: 16,
    lineHeight: 23.6026,
    left: 14,
    textWidth: 693,
    vertical: 22,
  });
});

test("the 860 and 1280 windows use Classic's 19px and 24px insets", () => {
  expect(classicLayout(860)).toMatchObject({
    fontSize: 19,
    left: 12,
    textWidth: 822,
    vertical: 26,
  });
  expect(classicLayout(1280)).toMatchObject({
    fontSize: 24,
    left: 114,
    textWidth: 1038,
    vertical: 32,
  });
});

test("a window narrower than Classic's 735 keeps its inset and narrows the column", () => {
  expect(classicLayout(560)).toMatchObject({ left: 14, textWidth: 517 });
  for (let width = 560; width <= 2560; width++) {
    const { left, textWidth } = classicLayout(width);
    expect(left).toBeGreaterThan(0);
    expect(left + textWidth + 5 + 15).toBeLessThanOrEqual(width + 1);
  }
});
