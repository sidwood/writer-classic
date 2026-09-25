# Writer Classic

A Tauri 2 and Vue 3 reimplementation targeting iA Writer Classic 2.1.6 on Apple Silicon. Vim is on by default; Edit → Vim Mode disables it and remembers that choice. Dark mode is in View.

This checkout is a working implementation, **not a claim of exact parity**. The acceptance matrix, reference sources, regression evidence and remaining fidelity gaps are in [docs/implementation.md](docs/implementation.md).

## Run on Apple Silicon

Requirements: macOS 11 or later, Xcode command-line tools, Node.js 22.12 or later, and Rust with the `aarch64-apple-darwin` target. This implementation uses Cocoa APIs and is macOS-specific.

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm ci
npm run tauri -- dev
```

Build the native application:

```sh
npm run tauri -- build --target aarch64-apple-darwin
open 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Writer Classic.app'
```

The app is locally built and ad-hoc signed, not notarized for distribution. `npm run dev` serves the browser verification fallback. Its Save action downloads a file rather than writing directly to disk; use the native app for document storage, versions, system dialogs and text services.

## Writing

- `i` enters Vim insert mode; Escape returns to normal mode. `v`, `V`, and Control-V select characterwise, linewise and blockwise. `:w`, `:q`, and `:wq` are supported.
- Command-N creates a document window. Command-O opens text or imports DOCX. Command-S saves UTF-8 text. Named documents autosave after a pause; unnamed drafts are recovered locally.
- Command-D toggles sentence focus. Command-R opens a separate preview. Option-Command-T toggles the format bar. Control-Command-F enters full screen.
- Command-B, Command-I, Command-minus and Command-1 through Command-6 apply Markdown formatting. Command-F opens find/replace.
- File → Browse All Versions reads macOS `NSFileVersion` versions. Save creates a version; automatic saves create one at least hourly while editing. Versions can be restored, copied or deleted.
- HTML, DOCX and RTF export use File → Export. PDF export uses the system print dialog's Save as PDF control.
- Native spelling/substitution menu items route to Cocoa's responder chain. Escape requests system word completion when Vim is off.

Text is not trimmed or normalized when opening or saving. UTF-8 BOMs, mixed CRLF/LF, tabs, duplicate lines and final newlines are retained. A changed file on disk blocks overwriting it; Save As keeps both copies. Cancelled or failed saves do not close the document.

## Reference assets and iCloud

The installed Classic application was inspected read-only. Its proprietary icons, fonts and other resources are not bundled. On a machine with Classic installed in `/Applications`, the native app can load its Nitti font in memory; otherwise it uses Menlo. This fallback is a visual parity limitation.

Files in an existing iCloud Drive folder can be selected through native dialogs. The original Classic iCloud container belongs to its publisher and cannot be assumed accessible. This checkout has no Apple Developer signing identity or iCloud container entitlement; private-container parity is not verified.

## Checks

```sh
npm test
npm run test:icons
npx playwright install chromium
npm run test:e2e
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
python3 scripts/verify-bundle.py # after the targeted native build above
qlty config validate
qlty check --all
```

`.githooks/commit-msg` checks commit messages. Enable it once per clone with `git config core.hooksPath .githooks`.

The browser suite tests actual Vim editing, default and persisted preferences, all visual-mode operators, raw file round trips, draft recovery, modal guards, find/replace, previews and export/import. Native dialog failures are tested at the Tauri boundary; Rust tests exercise real filesystem writes, symlinks, conflict rejection, native file versions and moves. They do not replace a controlled native desktop scenario.
