#!/bin/bash
# Drives the running debug app in-process and writes evidence to <directory>.
# Usage: scripts/native-selftest.sh docs/evidence/native-window
# Requires the Vite dev server on 127.0.0.1:1420 and a debug build
# (cargo build --manifest-path src-tauri/Cargo.toml).
# The app's WebKit storage and config are restored afterwards, so the typed test
# sentence and the Dark Mode toggle do not change the user's drafts or settings.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
backup="$(mktemp -d)"
state=("WebKit/com.sidwood.writer-classic" "WebKit/writer-classic" "Application Support/com.sidwood.writer-classic")
for item in "${state[@]}"; do
  [ -e "$HOME/Library/$item" ] && mkdir -p "$backup/$(dirname "$item")" && cp -a "$HOME/Library/$item" "$backup/$item"
done
rm -rf "$out" && mkdir -p "$out"
WRITER_CLASSIC_NATIVE_SELFTEST="$out" "$root/src-tauri/target/debug/writer-classic" >/dev/null 2>&1 &
pid=$!
for _ in $(seq 1 80); do
  sleep 0.5
  grep -q '"finished"' "$out/native-selftest.json" 2>/dev/null && break
done
lsappinfo info -only name -only bundleID -only executablepath "$(lsappinfo find pid=$pid)" >"$out/lsappinfo.txt" 2>&1
kill "$pid" 2>/dev/null
sleep 1
kill -9 "$pid" 2>/dev/null
for item in "${state[@]}"; do
  if [ -e "$backup/$item" ]; then
    rm -rf "$HOME/Library/$item" && cp -a "$backup/$item" "$HOME/Library/$item"
  fi
done
rm -rf "$backup"
cat "$out/native-selftest.json"
# Typed text counts only when the document window was key and main.
grep -q '"typingCounted" : true' "$out/native-selftest.json" || { echo "typing was not proven in a key and main window" >&2; exit 1; }
