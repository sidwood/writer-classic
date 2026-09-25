// Classic 2.1.6 adaptive layout, from contentSizeWithWidth:,
// writerFontSizeWithWorkflowState:contentSize:,
// writerLineHeightWithWorkflowState:contentSize:,
// writerFontNameWithWorkflowState:heading:backingScaleFactor:,
// containerWidthWithGlyphWidth:, textViewVerticalInset and the text container
// inset set in updateContentSize. Points are CSS pixels in WebKit.
export type ContentSize = 1 | 2 | 3;
/** Classic's workflow state. 1 is the Nitti Pro default. */
export type WorkflowState = 0 | 1 | 2 | 3;

export function contentSizeForWidth(width: number): ContentSize {
  if (width >= 1065) return 3;
  if (width >= 850) return 2;
  return 1;
}

/** Point sizes per workflow state and content size, read from the 2.1.6 binary. */
const FONT_SIZE: Record<WorkflowState, Record<ContentSize, number>> = {
  0: { 1: 17, 2: 20, 3: 25 },
  1: { 1: 16, 2: 19, 3: 24 },
  2: { 1: 14, 2: 16, 3: 21 },
  3: { 1: 14, 2: 16, 3: 21 },
};
/** Every workflow state shares one line-height table. */
const LINE_HEIGHT: Record<ContentSize, number> = {
  1: 23.6026,
  2: 27.854,
  3: 33.718,
};
/** The face writerFontNameWithWorkflowState: names for each state. */
export const WORKFLOW_FACE: Record<WorkflowState, string> = {
  0: "Nitti Grotesk",
  1: "Nitti Pro",
  2: "Tiempos Text",
  3: "Tiempos Text",
};
export const DEFAULT_WORKFLOW: WorkflowState = 1;

export function workflowState(value: unknown): WorkflowState {
  if (value === "0" || value === 0) return 0;
  if (value === "2" || value === 2) return 2;
  if (value === "3" || value === 3) return 3;
  return DEFAULT_WORKFLOW;
}

export function classicType(width: number, state: WorkflowState = 1) {
  const size = contentSizeForWidth(width);
  return {
    size,
    fontSize: FONT_SIZE[state][size],
    lineHeight: LINE_HEIGHT[size],
  };
}

/** Text container width for eighty space advances of the editor face. */
export function textMeasure(glyphWidth: number) {
  return Math.ceil(glyphWidth * 80 + 11);
}

/**
 * Nitti Pro's space advance in ems, inferred for Classic's inset: Classic's
 * minimum widths for its 19pt and 24pt steps (850 and 1065) are the narrowest
 * windows that hold the 80-space container plus a legacy scroller at about
 * 0.54em. The decrypted face drawn by the clone measures about 0.55em.
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

function inset(width: number, container: number) {
  return Math.ceil((width - container - SCROLLER_WIDTH) / 2);
}

/**
 * Where Classic puts the text block in a window of this width.
 *
 * `spaceEm` is the space advance of the face the editor actually draws. The
 * column is eighty of those advances, ceil(glyph × 80 + 11), centred with
 * ceil((window − container − scroller) / 2) plus line fragment padding. The
 * vertical inset is floor(lineHeight) − 1 below the title bar.
 *
 * A face wider than Nitti Pro cannot always fit eighty glyphs. The column then
 * narrows rather than give the text less margin than Classic gives Nitti Pro at
 * that width, capped at Classic's narrowest inset, so text never reaches the edge.
 */
export function classicLayout(
  width: number,
  spaceEm = NITTI_SPACE_EM,
  state: WorkflowState = 1,
) {
  const type = classicType(width, state);
  // Classic's own face is known only for Nitti Pro. Other states use the drawn face.
  const referenceEm = state === 1 ? NITTI_SPACE_EM : spaceEm;
  const classicInset = inset(width, textMeasure(type.fontSize * referenceEm));
  const floor =
    width < NARROWEST_WINDOW
      ? NARROWEST_INSET
      : Math.min(NARROWEST_INSET, Math.max(0, classicInset));
  let container = textMeasure(type.fontSize * spaceEm);
  let left = inset(width, container);
  if (left < floor) {
    left = floor;
    container = Math.max(0, width - SCROLLER_WIDTH - 2 * left);
  }
  return {
    ...type,
    left: left + LINE_FRAGMENT_PADDING,
    textWidth: container - 2 * LINE_FRAGMENT_PADDING,
    vertical: Math.floor(type.lineHeight) - 1,
  };
}

/**
 * Top padding the page needs so its first line starts Classic's inset,
 * floor(lineHeight) − 1, below the bottom edge of the title bar.
 *
 * `titlebar` is the title bar's height and `pageOrigin` is how far below the
 * window frame's top edge the page starts. The document window has a full-size
 * content view, and WebKit gives the web view a top content inset equal to the
 * title bar, so the page normally starts at the title bar's bottom edge and
 * needs only the inset. Any part of the title bar that covers the page is added.
 * In CSS that covered part is env(safe-area-inset-top).
 */
export function topPadding(
  vertical: number,
  titlebar: number,
  pageOrigin: number,
) {
  return Math.max(0, titlebar - pageOrigin) + vertical;
}

/** Distance from the window frame's top edge to the first line box. */
export function textTopBelowFrame(
  vertical: number,
  titlebar: number,
  pageOrigin: number,
) {
  return pageOrigin + topPadding(vertical, titlebar, pageOrigin);
}
