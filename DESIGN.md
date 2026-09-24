# Classic writing window

## Authority and composition

Preserve the installed Classic 2.1.6 writing window. Its bundled `focus-mode-mac-chrome.png` and `format-bar-active.png` show the grey sheet, monospaced text, cyan caret and selection, sentence dimming, bottom formatting bar and counts. The native title bar supplies centered document chrome and left-side traffic lights. No sidebar, dashboard, app-name banner or second native title header.

The editor is the primary surface. It uses a centered writing measure with ample blank space, a native macOS menu, and a compact bottom row. Chrome fades during typing and returns on pointer/focus interaction. The browser fallback includes an application menu and centered document title, rather than pretending to be the native app.

## Tokens

- Light paper `#f0f0f0`, text `#424242`, chrome `#ededed`, divider `#d7d7d7`, cyan caret `#00aeef`, selection `#b7e8fa`.
- Dark paper `#202124`, text `#d7d7d7`, chrome `#27282b`, divider `#3b3c3f`, caret `#58c8f0`, selection `#24566b`.
- Native installed Nitti Medium, Bold and MediumItalic when available, otherwise Menlo. The fallback is documented, not called pixel-equivalent.
- Editor 19px, 1.58 line height, maximum 780px container, 38px side inset. Narrow windows reduce insets; less-used format buttons remain available through native menus and shortcuts.
- Platform system font for controls. No decorative icons or imagery in the writing sheet.

## Interaction and accessibility

Focus mode dims non-current sentences, intentionally following Classic's lower-contrast inactive text. Selection-aware word/character/reading-time values stay in the footer. The Vim state distinguishes NORMAL, INSERT, VISUAL, VISUAL LINE and VISUAL BLOCK.

Save/discard/cancel dialogs take keyboard focus and trap Tab; typing must not leak into the document behind them. File errors are visible and preserve the document. Formatting controls have accessible labels and visible focus rings. Reduced-motion preferences disable chrome transitions.

## Verification limits

Browser light/dark captures and executable scenarios are recorded in `docs/evidence`. Native screenshots were unavailable, and later desktop interaction was not controlled by the implementation agent. Native title/icon geometry and complete Classic visual parity therefore require a later controlled verification; the browser captures are not native proof.
