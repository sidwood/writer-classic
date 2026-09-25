# Native window evidence

The running debug binary, `src-tauri/target/debug/writer-classic` (process `com.sidwood.writer-classic` WebKit data, Dock name below), was driven in-process by `src-tauri/src/classic-selftest.m`:

```sh
cargo build --manifest-path src-tauri/Cargo.toml
scripts/native-selftest.sh docs/evidence/native-window
```

System Events is denied to this runner (`-1743`), `AXIsProcessTrusted()` is false, `CGPreflightScreenCaptureAccess()` is false, and cliclick reports no Accessibility privilege, so no external driver could post events or capture the screen. The self-test instead posts real `NSEvent` mouse and key events into `NSApp`'s event queue, which reach the editor through NSApplication, the window, and its first responder, as hardware events do. It triggers View ▸ Dark Mode by `performActionForItemAtIndex:` on the real main-menu item, which sends the same action a click sends when tracking ends. It reads the page with `evaluateJavaScript:`, snapshots the web view with `takeSnapshotWithConfiguration:`, and prints to PDF through the web view's print operation. The script restores the app's WebKit storage and config afterwards.

## Before the fix (bcf03bd plus the self-test only)

`before-fix-selftest.json`: no visible document window after 20 seconds. The page error was `window.show not allowed. Permissions associated with this command: core:window:allow-show`, so startup stopped before the menu-action and focus listeners were registered. The only visible window was an AppKit untitled `ClassicHistoryDocument` window (`contentViewClass` NSView, no web view) holding a read-only text view. That is the window where typing and View ▸ Dark Mode did nothing.

## After the fix

`active-launch/` (08:25, app activated at launch):

- After show: key and main, first responder `WryWebView` (a `WKWebView` subclass).
- Clicked the editor, pressed `i`, typed `Typed in the native window.`, pressed Escape. Page text: `Typed in the native window.` Snapshot: `active-launch/native-typing.png`.
- View ▸ Dark Mode: item state off → on. `html` class `dark`, body background `rgb(32, 33, 36)`. Snapshot: `active-launch/native-dark-mode.png`.
- Print to PDF (`active-launch/native-print.pdf`) text: `Untitled 25/09/2026, 08:25` / `Typed in the native window.` / `Page 1 of 1`.
- `lsappinfo`: `"LSDisplayName"="Writer Classic"`.

Top-level files (08:33, launched while another app was frontmost, so macOS did not activate it):

- The document window was neither key nor main. Text still arrived through events posted to that window: `Typed in the native window.` Posted events can reach a window that is not key, so this run is not typing proof. The self-test now records `typingCounted` and counts the sentence only when the window was key and main while typing and after it.
- View ▸ Dark Mode with no key or main window: checked, body `rgb(32, 33, 36)`.
- A second, non-document window was made key and main, and View ▸ Dark Mode was chosen again. The visible document window received it: item unchecked, body `rgb(240, 240, 240)`.
- Print PDF: `Untitled 25/09/2026, 08:33` / `Typed in the native window.` / `Page 1 of 1`.
- `lsappinfo.txt`: `"LSDisplayName"="Writer Classic"`.

`key-check/` (after the key-and-main rule was added): `typingKeyAndMain` true, `typingCounted` true, page text ends `Typed in the native window.`, View ▸ Dark Mode checked.

Not covered: a human pointer click on the macOS menu bar and hardware key presses, and the Dock tile pixels. Those need Accessibility or Screen Recording permission this runner does not have.
