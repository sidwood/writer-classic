// Classic 2.1.6 adaptive layout for its Nitti Pro face, from
// contentSizeWithWidth:, writerFontSizeWithWorkflowState:contentSize:,
// writerLineHeightWithWorkflowState:contentSize: and
// containerWidthWithGlyphWidth:. Points are CSS pixels in WebKit.
export type ContentSize = 1 | 2 | 3;

export function contentSizeForWidth(width: number): ContentSize {
  if (width >= 1065) return 3;
  if (width >= 850) return 2;
  return 1;
}

const FONT_SIZE = { 1: 16, 2: 19, 3: 24 } as const;
const LINE_HEIGHT = { 1: 23.6026, 2: 27.854, 3: 33.718 } as const;

export function classicType(width: number) {
  const size = contentSizeForWidth(width);
  return { size, fontSize: FONT_SIZE[size], lineHeight: LINE_HEIGHT[size] };
}

/** Text measure for eighty glyphs of the editor face. */
export function textMeasure(glyphWidth: number) {
  return Math.ceil(glyphWidth * 80 + 11);
}
