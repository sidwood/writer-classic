# Implementation record

## Frozen contract

Reimplement iA Writer Classic using Tauri and Vue.js on Apple Silicon, exactly, with Vim mode and dark mode added. Write only in `/Users/sidwood/code/ia-writer-classic-clone.goal`, not the original checkout.

## Reference

The installed `/Applications/iA Writer Classic.app` is version 2.1.6, build 6002. Its `Contents/Resources/iAWriterHelp/Contents/Resources/English.lproj/` help and `iA Writer Release Notes.txt` are primary behavioral references. Its help screenshots `images/@2x/focus-mode-mac-chrome.png`, `format-bar-active.png`, and `preview-mac.png` are visual references. These are inspected read-only, not redistributed. Modern iA Writer is not the reference.

Observed Classic requirements: plain-text UTF-8 Markdown documents; multiple document windows; new, duplicate, open/recent, save/as, rename/move; automatic save including unnamed drafts; native document versions; iCloud; DOCX import; HTML/RTF/DOCX/PDF export; formatted printing; Auto Markdown; Writer Flavored Markdown including single-return paragraphs, nested list shorthand and footnotes; separate live preview; sentence focus; full screen; fading chrome; selection-aware word/character/reading-time counts; format bar; find/replace; system spellcheck, grammar, completion, substitutions, dictionary and dictation; native shortcuts. Exact equivalence is not inferred from a functioning editor.

## Acceptance matrix

| Literal clause                                               | Current-checkout verification                                                     | Status                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------- |
| Reimplement iA Writer Classic exactly                        | Installed 2.1.6 reference; residual gaps below                                    | Not established                               |
| Using Tauri                                                  | Native arm64 application build succeeds                                           | Passed                                        |
| Using Vue.js                                                 | Typecheck/Vite build and 38 browser scenarios                                     | Passed                                        |
| Works on Apple Silicon                                       | Mach-O arm64 bundle verified by `scripts/verify-bundle.py`                        | Build passed                                  |
| Vim mode                                                     | Motions/operators/search/Ex save, visual matrix, Ctrl chords stay in the editor   | Passed tested cases                           |
| Dark mode                                                    | Toggle/reload/editor and preview computed color                                   | Passed tested cases                           |
| Goal checkout only                                           | All source/assets/evidence under designated checkout                              | Passed                                        |
| Missing Vim preference on; explicit off persists             | `tests/e2e/vim.spec.ts`; native checkbox startup sync in `review-routing.spec.ts` | Passed                                        |
| v/V/Ctrl-v indicators and y/c/d/undo                         | Indicator effective opacity 1; visual undo including Ctrl-[, Ctrl-c, s, and C     | Passed tested cases                           |
| Checked Vim in Edit, not View, synchronized                  | Edit checkbox; no-focus restore; persisted-off startup                            | Passed tested cases; live menu bar unverified |
| Centered icon/title; traffic lights; no second native header | Browser 860/1280; AppKit frames in `docs/evidence/native-title-geometry.txt`      | Passed measured geometry                      |
| Unreadable screenshot; Classic pattern controls              | Centered proxy plus title, traffic lights left, system title hidden               | Implemented and measured                      |
| Original icons and Markdown association                      | Bundled bytes match `brand/`; UTI icon and Classic extensions in the built plist  | Passed                                        |

## Repair findings

| Root cause                                          | Fix                                                                          | Regression                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| Cancelled Save-and-Close still destroyed the window | Cancel increments a transition epoch and rechecks dirty state before close   | `review-lifecycle.spec.ts` delayed Escape            |
| Cancel left autosave suppressed                     | Cancel reschedules the named-document timer                                  | Close and Last Opened cancel tests                   |
| Clean recovery showed a stale draft                 | Clean named drafts reload from disk; dirty drafts and read failures are kept | `review-lifecycle.spec.ts`, `review-routing.spec.ts` |
| Ctrl chords ran Command shortcuts                   | macOS app shortcuts match Command only; Ctrl+Command+F remains full screen   | `review-ui.spec.ts`                                  |
| Browser preview dark class missed `:root`           | Dark class is set on `documentElement`; computed color is asserted           | `review-ui.spec.ts`, `writer.spec.ts`                |
| Shorter or different fences closed code             | Fence close requires the opening delimiter and at least its length           | `tests/review-regressions.test.ts`                   |
| Native title left-aligned                           | Custom centered proxy and title; system title hidden; resize observer        | `native-title-geometry.txt`, cargo geometry test     |
| Preview-focused Quit ignored                        | Quit is independent of focus and waits for each document once                | `menu_route` and quit-tracker tests                  |
| iCloud was status-only                              | Browse, encoding-aware open, save, and move-to-container commands            | `review-routing.spec.ts`; live container blocked     |
| Versions were a custom timestamp list               | `browseDocumentVersions:` plus Last Saved, Previous Save, and Last Opened    | Command tests; interactive timeline not driven       |
| Alternate encodings absent                          | Native Open encoding popup; non-lossy save in the chosen encoding            | Rust CP1252/UTF-16 test; e2e wiring test             |
| Delayed clean recovery replaced typing            | Disk reload applies only if the document is still that clean text            | `review-routing.spec.ts` delayed read           |
| AppleScript get/set ignored document and property | Object specifiers resolve the requested document and property                | In-process get/set selftest                     |
| Autosave skipped while busy was dropped           | A busy automatic save is rescheduled                                         | `review-routing.spec.ts` busy save              |
| Empty and closed documents were unscriptable      | Startup notes every document, including empty; close forgets it              | `review-routing.spec.ts` registry test          |
| Versions were read as UTF-8                       | Version read/write uses the document encoding and keeps the original bytes   | Rust CP1252/UTF-16 version test; browser selftest |
| Quick Look rewrote code, lists, emphasis, fences  | Preview protects code spans and matches fence length and list shorthand      | Quick Look semantics check                      |
| Fresh windows were unscriptable and closed ones stayed listed | Note on mount and after apply; forget on close; skip nil windows | Scripting selftest; registry e2e |
| New, Duplicate, and recovered windows appeared before the title | Those windows start hidden and show after the document header | `review-routing.spec.ts` hidden-window test |
| Browser tab title waited for the first edit | `document.title` is set from `doc.title` on mount | `title.spec.ts` initial title |
| Revert and Versions replaced typing during the disk read | Replacement is dropped when the edit epoch changes after the read starts | `review-routing.spec.ts` revert and versions-finished |
| Save As kept the encoding that could not store the text | Save As writes UTF-8 when the encoding error offers that recovery | `review-routing.spec.ts` UTF-8 recovery |
| Command-W on Preview closed the document | Focused Preview close closes that window only | `menu_route` CloseWindow |
| Vim from an orphan Preview left the checkbox flipped | The checkbox is restored to the editor preference | `menu_route` RestoreVim |
| AppleScript returned document names | Front document and document lists return object specifiers; get/set honor the requested document and property | AppleScript selftest |
| Quick Look dropped indented code, underscore emphasis, quotes, and breaks | Preview emits code, emphasis, blockquote, and hr for those constructs | Quick Look semantics check |
| Command-P printed formatted HTML | Command-P prints plain text; Option-Command-P prints formatted HTML | `review-ui.spec.ts` print |
| Format bar ignored caret formatting | Heading, emphasis, strong, strike, and list marks follow the caret line | `review-ui.spec.ts`, `format-marks` unit test |
| Smart Links and Data Detection did not open in the native app | Detected links, phones, and addresses open through NSWorkspace | `review-routing.spec.ts`; URL dry-run |
| Web-created document windows could appear before the centered header | They stay hidden, titled with the file name, and show only after the header is set | `review-routing.spec.ts` hidden-window test |

Named-review extras covered by the same checks: the Vim indicator stays effectively opaque after edits; the native checkbox follows a persisted-off preference and is restored when no editor accepts the toggle; `document.title` is the document title only, with the dirty dot on the close control; `UTTypeIconFile` is `markdown-document-icon`; menu, quit, and preview events use `emit_to` and the current webview window; visual `c` is not armed while keys are pending, disarms on return to normal, and `s`/`C` share the change undo group.

## Document states and preservation

Empty untitled, edited untitled, clean named, edited named, saving, save/open failure, pending destructive transition. Editing changes text only; successful save changes saved text/path only after completion. Failed/cancelled dialogs preserve document, path, dirty state and undo. Closing/replacing an unsaved document requires Save/Discard/Cancel. Save cancellation or failure aborts the pending transition. New/duplicate create independent documents. Saving captures a snapshot; edits made during a write stay dirty. Autosave/draft recovery must not discard unsaved text.

Text is raw, not trimmed, normalized, deduplicated or reordered. Empty text, repeated lines, whitespace, Unicode and final newline are valid. File paths are caller-selected, not silently redirected. The backend returns ordinary JSON objects/strings/arrays, with nullable path for unnamed documents. No public return type was specified by the contract.

## Fidelity gaps and constraints

Exact Classic parity is not established and is not claimed by this repair.

Blocked or remaining exact-parity obligations:

- Nitti: proprietary. It is loaded read-only from an installed Classic at runtime and is not redistributed. Without that install, the face falls back to Menlo. No licensing authority was available to bundle it.
- iCloud signing: `security find-identity -v -p codesigning` found 0 valid identities. The ubiquity probe returns no container. `src-tauri/Entitlements.icloud.plist` and `src-tauri/tauri.icloud.conf.json` are opt-in so an unsigned default build is not killed for an ungrantable entitlement. The browse/open/save/move workflow is implemented; live container verification is blocked until Sid provides a signing identity and container. This commit does not claim iCloud live signing.
- Quick Look system registration: the preview extension is a sandboxed arm64 appex with `LC_MAIN` and `_NSExtensionMain`. `pluginkit -a -v` exits 0 but `pluginkit -m` reports `(no matches)`. `security find-identity -v -p codesigning` found 0 valid identities, and the signature is ad-hoc. Registration still requires a signing identity. `qlmanage -g` reports `Can't get generator`. Exact command output is in `docs/evidence/quicklook-registration.txt`. This commit does not claim system Quick Look works on this Mac. In-process preview HTML is tested.
- Help and AppleScript are implemented in this checkout. They do not establish exact Classic parity. Live `osascript` from this runner is denied by TCC (`-1743`). The scripting handlers and sdef are tested in-process, including document object specifiers.
- The interactive NSDocument version timeline was not driven in this session, so title-bar timeline visuals are unverified. The File command calls `browseDocumentVersions:`, and Last Saved / Previous Save / Last Opened have tested semantics. Accessibility inspection of a launched bundle was not authorized (`AX` returned no children; System Events Apple events were denied).
- Find/replace, statistics, line width, typography, animation timing, and the DOCX/RTF corpus are still not proven equivalent to Classic. The format bar now reflects caret marks, but Classic's exact active-state artwork is not claimed. Duplicate `fileAssociations` in `tauri.conf.json` is inert while `Info.plist` is the association source; it was left in place.

## Validation evidence

- `npm test`: 8 unit tests passed, including caret format marks, mixed-delimiter fences, and smart copy/paste plus data detection.
- `npm run test:e2e`: 50 Chromium scenarios passed, including revert/versions typing, UTF-8 Save As, print modes, format-bar marks, and native detection clicks.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 23 tests passed. Native title frames stay centered. The Quick Look generator loads and previews markdown and text. The help book indexes. AppleScript get, set, and open round-trip in-process and return document specifiers. Detected URLs are handed to NSWorkspace in a dry run. Bring All to Front keeps both windows visible in order.
- `npm run build` and `npm run tauri -- build --target aarch64-apple-darwin`: passed. Vite reports a large bundle warning.
- `python3 scripts/verify-bundle.py`: passed arm64 executable, Classic Markdown extensions, UTI icon, handed-off icon bytes, Quick Look generator, help book, and AppleScript definition.

The asset owner relinquished brand/icons ownership explicitly; original handoff assets are included without regeneration.

## Deferred

No new product features were added to the contract. Large-bundle optimization is deferred. The fidelity gaps above remain unmet or blocked contract work, not an approved scope reduction.

## Contract amendments received

Contract amendment. Authoritative. Supersedes the earlier Vim menu placement and the off-by-default Vim preference.

- Vim mode is on by default. Persist an explicit off choice. A missing preference means on.
- Vim compatibility includes visual mode: characterwise (v), linewise (V), and blockwise (Ctrl-v). The mode indicator must show VISUAL, VISUAL LINE, and VISUAL BLOCK. Yank, change, delete, and undo must work from those visual modes.
- The Vim Mode toggle is a checkbox in the Edit menu, not View. Native menu and browser menu both. Remove it from View. Keep the checkmark in sync with the editor.
- Centralized header, matching iA Writer Classic 2.1.6: the window title bar centers the document title, with the markdown document icon immediately to the left of that title. Traffic lights stay on the left. Do not add a second in-window title header. The browser fallback uses the same centered icon-plus-title header.
- The attached 20:32 screenshot could not be read from this session (macOS privacy on TemporaryItems). Match the Classic title-bar pattern above. Do not invent a left-aligned app title.
- Write only in /Users/sidwood/code/ia-writer-classic-clone.goal.
- Do not copy proprietary iA Writer icon bytes. An Opus 5.5 agent now owns src-tauri/icons and brand/markdown-document-icon.\*. Do not regenerate those files. Wire the markdown document icon into the title-bar proxy and the markdown file association.

Later Sid requirements, also authoritative:

- Focus mode dims and blurs every sentence except the one at the caret. The caret sentence stays sharp and full contrast. Do not blur the whole editor. The rule is in `src/style.css` `.unfocused-sentence`.
- The browser header shows `doc.title` only. No ` — Edited` suffix. Dirty state is the close-button dot.
- The full Opus review at `/tmp/ia-writer-reviews/opus.md` is an acceptance gate. A commit is not finished while a non-signing finding from that report is unimplemented.
- Task `task-1-0-96` owns the previously open items: a Quick Look generator for markdown and text, a Help menu and help book, an AppleScript definition for getting and setting the front document text and opening a file, and Window ▸ Bring All to Front, Edit ▸ Delete, Substitutions ▸ Smart Copy/Paste, Smart Links, and Data Detection. Implementing those items does not prove the rest of Classic parity.
- Do not copy Nitti. iCloud live signing remains blocked while no signing identity exists. Leave the opt-in entitlement as it is.
