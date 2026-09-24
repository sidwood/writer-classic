# Implementation record

## Frozen contract

Reimplement iA Writer Classic using Tauri and Vue.js on Apple Silicon, exactly, with Vim mode and dark mode added. Write only in `/Users/sidwood/code/ia-writer-classic-clone.goal`, not the original checkout.

## Reference

The installed `/Applications/iA Writer Classic.app` is version 2.1.6, build 6002. Its `Contents/Resources/iAWriterHelp/Contents/Resources/English.lproj/` help and `iA Writer Release Notes.txt` are primary behavioral references. Its help screenshots `images/@2x/focus-mode-mac-chrome.png`, `format-bar-active.png`, and `preview-mac.png` are visual references. These are inspected read-only, not redistributed. Modern iA Writer is not the reference.

Observed Classic requirements: plain-text UTF-8 Markdown documents; multiple document windows; new, duplicate, open/recent, save/as, rename/move; automatic save including unnamed drafts; native document versions; iCloud; DOCX import; HTML/RTF/DOCX/PDF export; formatted printing; Auto Markdown; Writer Flavored Markdown including single-return paragraphs, nested list shorthand and footnotes; separate live preview; sentence focus; full screen; fading chrome; selection-aware word/character/reading-time counts; format bar; find/replace; system spellcheck, grammar, completion, substitutions, dictionary and dictation; native shortcuts. Exact equivalence is not inferred from a functioning editor.

## Acceptance matrix

| Literal clause                                               | Current-checkout verification                                                                                       | Status                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Reimplement iA Writer Classic exactly                        | Installed 2.1.6 reference; tests below; residual gaps below                                                         | Not established                                   |
| Using Tauri                                                  | Native arm64 application build succeeds                                                                             | Passed                                            |
| Using Vue.js                                                 | Typecheck/Vite build and 20 browser scenarios                                                                       | Passed                                            |
| Works on Apple Silicon                                       | Mach-O arm64 build and native launch observed; controlled desktop scenario interrupted                              | Build passed; full native scenario unverified     |
| Vim mode                                                     | Real Vim motions/operators/search/Ex save, visual matrix                                                            | Passed tested cases                               |
| Dark mode                                                    | Toggle/reload/editor/preview tests and screenshot                                                                   | Passed tested cases                               |
| Goal checkout only                                           | All source/assets/evidence under designated checkout; explicit-path staging                                         | Passed                                            |
| Missing Vim preference on; explicit off persists             | `tests/e2e/vim.spec.ts` reload/toggle test                                                                          | Passed                                            |
| v/V/Ctrl-v indicators and y/c/d/undo                         | Nine visual operator cases in `vim.spec.ts`                                                                         | Passed                                            |
| Checked Vim in Edit, not View, synchronized                  | Browser DOM tests; native bridge toggle/check synchronization; Cocoa CheckMenuItem                                  | Tests passed; live Cocoa inspection unverified    |
| Centered icon/title; traffic lights; no second native header | Browser geometry at 860/1280px; native bridge verifies PNG bytes and absent browser header; NSWindow document proxy | Browser passed; native visual geometry unverified |
| Unreadable screenshot; Classic pattern controls              | Native decorated NSWindow retained; no invented title bar                                                           | Implemented                                       |
| Original icons and Markdown association                      | Owner provenance `brand/ICONS.md`; `scripts/verify-bundle.py` compares bundled bytes and association                | Passed                                            |

## Document states and preservation

Empty untitled, edited untitled, clean named, edited named, saving, save/open failure, pending destructive transition. Editing changes text only; successful save changes saved text/path only after completion. Failed/cancelled dialogs preserve document, path, dirty state and undo. Closing/replacing an unsaved document requires Save/Discard/Cancel. Save cancellation or failure aborts the pending transition. New/duplicate create independent documents. Saving captures a snapshot; edits made during a write stay dirty. Autosave/draft recovery must not discard unsaved text.

Text is raw, not trimmed, normalized, deduplicated or reordered. Empty text, repeated lines, whitespace, Unicode and final newline are valid. File paths are caller-selected, not silently redirected. The backend returns ordinary JSON objects/strings/arrays, with nullable path for unnamed documents. No public return type was specified by the contract.

## Fidelity gaps and constraints

Exact parity remains unverified and is not claimed. Concrete external blockers: `security find-identity -v -p codesigning` found **0 valid identities**; the real `NSFileManager.URLForUbiquityContainerIdentifier(nil)` probe returned no container. The app has no iCloud container entitlement. Opening an existing iCloud Drive path through a dialog is not equivalent to Classic's private container. Licensed Nitti is loaded read-only from installed Classic when available; otherwise Menlo differs visually.

Native screen capture failed with `could not create image from display`. Native windows launched and AX initially exposed the fixture. Later someone outside the agent edited both application windows, including `native-fixture.md`. The agent stopped shared-desktop automation, did not send further keys, and did not terminate either process. `native-open-ax.txt` and the fixture are uncontrolled evidence, not a deterministic edit/save/reopen test. Native header geometry, text-service action results, print/PDF, full screen, native preview and multi-window recovery require controlled follow-up.

Known remaining implementation/fidelity gaps (not external blockers): versions use real NSFileVersion storage but a custom browser, not Apple's Time Machine-like NSDocument browser; macOS Quick Look extension and native document locking are absent; find/replace uses CodeMirror rather than every Classic native pattern option; statistics use a 210-wpm estimate and whitespace word segmentation rather than a measured Classic oracle; exact format-bar active states, line width, typography and animation timings are not proven equivalent. DOCX/RTF conversion covers tested formatting but not a comprehensive Classic conversion corpus. Cocoa spelling/substitution routing and system completion are implemented, but full dictionary/dictation/services equivalence is not established. No claim that these gaps are approved scope reductions.

## Validation evidence

- `npm test`: 4 unit tests passed (raw document state and Classic Markdown paragraph/list/footnote/security behavior).
- `npm run test:e2e`: 20 Chromium scenarios passed, including raw BOM/CRLF/Unicode/empty files, draft transitions/modal typing guard, actual Vim visual operations, title geometry, native bridge save failure/cancel, dark mode, preview, find/replace, HTML/RTF/DOCX conversion.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 6 native Rust tests passed; actual versions survive atomic replacement, move refuses overwrite, symlinks remain aliases, text round trips and external conflicts are preserved. iCloud probe reports unavailable (not cloud parity success).
- `npm run build` and `npm run tauri -- build --target aarch64-apple-darwin`: passed; build log in `evidence/build.log`. Vite reports a large bundle warning.
- `python3 scripts/verify-bundle.py`: passed arm64 executable, Markdown file association, handed-off document/app icon byte checks.
- `plutil -lint src-tauri/Info.plist`: passed.
- `qlty config validate`, `qlty check --all`: passed after formatting. Rustfmt pinned to Qlty's available 1.77.2 runtime; default 1.82.0 runtime check failed before configuration correction.
- Impeccable detector: `evidence/design-detector.json` contains no findings. Visual evidence: `browser-light.png`, `browser-dark.png`, `browser-visual-block.yaml`; browser fallback only.
- `npm audit`: zero vulnerabilities after updating Vitest. Node 26 emits an experimental localStorage warning while importing the DOCX test library; tests pass.

The latest browser fixture demonstrates VISUAL BLOCK and the centered icon/title in both themes. The asset owner relinquished brand/icons ownership explicitly; original handoff assets are included without regeneration.

## Deferred

No new product features were added to the contract. Large-bundle optimization is deferred. The fidelity gaps above remain unmet/unverified contract work, not an approved deferred feature list.

## Contract amendments received

Contract amendment. Authoritative. Supersedes the earlier Vim menu placement and the off-by-default Vim preference.

- Vim mode is on by default. Persist an explicit off choice. A missing preference means on.
- Vim compatibility includes visual mode: characterwise (v), linewise (V), and blockwise (Ctrl-v). The mode indicator must show VISUAL, VISUAL LINE, and VISUAL BLOCK. Yank, change, delete, and undo must work from those visual modes.
- The Vim Mode toggle is a checkbox in the Edit menu, not View. Native menu and browser menu both. Remove it from View. Keep the checkmark in sync with the editor.
- Centralized header, matching iA Writer Classic 2.1.6: the window title bar centers the document title, with the markdown document icon immediately to the left of that title. Traffic lights stay on the left. Do not add a second in-window title header. The browser fallback uses the same centered icon-plus-title header.
- The attached 20:32 screenshot could not be read from this session (macOS privacy on TemporaryItems). Match the Classic title-bar pattern above. Do not invent a left-aligned app title.
- Write only in /Users/sidwood/code/ia-writer-classic-clone.goal.
- Do not copy proprietary iA Writer icon bytes. An Opus 5.5 agent now owns src-tauri/icons and brand/markdown-document-icon.\*. Do not regenerate those files. Wire the markdown document icon into the title-bar proxy and the markdown file association.
