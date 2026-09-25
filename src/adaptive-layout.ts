// Classic 2.1.6 adaptive layout for its Nitti Pro face, from
// contentSizeWithWidth:, writerFontSizeWithWorkflowState:contentSize:,
// writerLineHeightWithWorkflowState:contentSize:, containerWidthWithGlyphWidth:,
// textViewVerticalInset and the text container inset set in updateContentSize.
// Points are CSS pixels in WebKit.
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

/** Text container width for eighty space advances of the editor face. */
export function textMeasure(glyphWidth: number) {
  return Math.ceil(glyphWidth * 80 + 11);
}

/**
 * Nitti Pro's space advance in ems. The installed faces are obfuscated and
 * cannot be measured, so this is inferred: Classic's minimum widths for its
 * 19pt and 24pt steps (850 and 1065) are the narrowest windows that hold the
 * 80-space container plus a legacy scroller at about 0.54em.
 */
export const NITTI_SPACE_EM = 0.54;
/** NSScroller legacy width that Classic subtracts before centring. */
export const SCROLLER_WIDTH = 15;
/** NSTextContainer lineFragmentPadding on each side of the text. */
export const LINE_FRAGMENT_PADDING = 5;
/** Classic's narrowest window, from IADocument.nib minSize. */
const NARROWEST_WINDOW = 735;
const NARROWEST_INSET = Math.ceil(
  (NARROWEST_WINDOW - textMeasure(16 * NITTI_SPACE_EM) - SCROLLER_WIDTH) / 2,
);

/**
 * Where Classic puts the text block in a window of this width: the horizontal
 * inset is ceil((window − container − scroller) / 2) plus line fragment
 * padding, and the vertical inset is floor(lineHeight) − 1 below the title bar.
 */
export function classicLayout(width: number) {
  const type = classicType(width);
  let container = textMeasure(type.fontSize * NITTI_SPACE_EM);
  let inset = Math.ceil((width - container - SCROLLER_WIDTH) / 2);
  // Classic's window cannot be narrower than 735; the clone's can. Keep
  // Classic's narrowest inset there and narrow the column instead.
  if (width < NARROWEST_WINDOW && inset < NARROWEST_INSET) {
    inset = NARROWEST_INSET;
    container = Math.max(0, width - SCROLLER_WIDTH - 2 * inset);
  }
  return {
    ...type,
    left: inset + LINE_FRAGMENT_PADDING,
    textWidth: container - 2 * LINE_FRAGMENT_PADDING,
    vertical: Math.floor(type.lineHeight) - 1,
  };
}
