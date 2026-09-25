import { expect, test } from "vitest";
import {
  WORKFLOW_FACE,
  classicLayout,
  classicType,
  contentSizeForWidth,
  textMeasure,
  textTopBelowFrame,
  topPadding,
  workflowState,
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

test("each workflow state has Classic's own size table and one line-height table", () => {
  const sizes = (state: 0 | 1 | 2 | 3) =>
    [735, 860, 1280].map((width) => classicType(width, state).fontSize);
  expect(sizes(0)).toEqual([17, 20, 25]);
  expect(sizes(1)).toEqual([16, 19, 24]);
  expect(sizes(2)).toEqual([14, 16, 21]);
  expect(sizes(3)).toEqual([14, 16, 21]);
  for (const state of [0, 1, 2, 3] as const)
    expect(
      [735, 860, 1280].map((w) => classicType(w, state).lineHeight),
    ).toEqual([23.6026, 27.854, 33.718]);
  expect(WORKFLOW_FACE).toEqual({
    0: "Nitti Grotesk",
    1: "Nitti Pro",
    2: "Tiempos Text",
    3: "Tiempos Text",
  });
});

test("a missing or unknown workflow preference means Nitti Pro, state 1", () => {
  expect(workflowState(null)).toBe(1);
  expect(workflowState("7")).toBe(1);
  expect(workflowState("0")).toBe(0);
  expect(workflowState("2")).toBe(2);
});

// Menlo's space is 9.6328125px at 16px, so 0.60205078125em.
const MENLO_EM = 9.6328125 / 16;

test("the column is eighty advances of the drawn face, not the 0.54em Nitti guess", () => {
  // 24px Menlo: ceil(14.44921875 × 80 + 11) = 1167, inset ceil((1280 − 1167 − 15) / 2) = 49.
  expect(classicLayout(1280, MENLO_EM)).toMatchObject({
    fontSize: 24,
    left: 54,
    textWidth: 1157,
  });
  expect(classicLayout(1280, MENLO_EM).textWidth).not.toBe(
    classicLayout(1280).textWidth,
  );
});

test("a drawn face too wide for eighty glyphs keeps Classic's margin and narrows", () => {
  // 80 Menlo spaces at 16px are 782px, wider than Classic's 735 window allows.
  expect(classicLayout(735, MENLO_EM)).toMatchObject({
    left: 14,
    textWidth: 692,
  });
  // Classic gives Nitti Pro a 7px inset at 860; Menlo keeps that margin.
  expect(classicLayout(860, MENLO_EM)).toMatchObject({
    left: 12,
    textWidth: 821,
  });
  for (let width = 560; width <= 2560; width++) {
    const { left, textWidth } = classicLayout(width, MENLO_EM);
    expect(left).toBeGreaterThanOrEqual(5);
    expect(left + textWidth + 5 + 15).toBeLessThanOrEqual(width + 1);
  }
});

test("Tiempos and Grotesk states fall back to the drawn face at their own sizes", () => {
  expect(classicLayout(735, MENLO_EM, 2)).toMatchObject({ fontSize: 14 });
  expect(classicLayout(735, MENLO_EM, 0)).toMatchObject({ fontSize: 17 });
});

test("at Classic's 735 window the first line starts the title bar plus 22px below the frame", () => {
  const { vertical } = classicLayout(735);
  // WebKit starts the page at the 32pt title bar's bottom edge: only the inset is padding.
  expect(topPadding(vertical, 32, 32)).toBe(22);
  expect(textTopBelowFrame(vertical, 32, 32)).toBe(32 + 22);
  // A page drawn from the frame's top edge, under the title bar, pads by both.
  expect(topPadding(vertical, 32, 0)).toBe(32 + 22);
  expect(textTopBelowFrame(vertical, 32, 0)).toBe(32 + 22);
  // A page that starts partly under the title bar pads by the covered part.
  expect(textTopBelowFrame(vertical, 32, 12)).toBe(32 + 22);
});
