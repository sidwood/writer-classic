#!/bin/bash
# Light-mode layout golden: the clone's native window against installed iA Writer Classic.
# Usage: scripts/classic-golden.sh [output directory]
# Needs the Vite dev server on 127.0.0.1:1420, a debug build
# (cargo build --manifest-path src-tauri/Cargo.toml), and Screen Recording
# permission for the terminal so Classic's window can be captured.
# Exit 0: text inset, top padding, line pitch and cap height match Classic.
# Exit 1: they differ, or the comparator failed its same-origin self-check.
# Exit 2: Classic could not be captured, so nothing was compared.
# There is no browser fallback: a Chromium screenshot is not the native window.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/docs/evidence/classic-golden}"
mkdir -p "$out" && out="$(cd "$out" && pwd)"
rm -f "$out"/golden-* "$out/native-selftest.json"
fixture="$root/tests/golden/classic-layout.md"
swift "$root/scripts/classic-golden.swift" classic "$out" "$fixture"
classic=$?
# Match the clone to Classic's window width, or to the one on screen when capture is denied.
size="$(/usr/bin/python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))
w=d.get("windowWidth"); h=d.get("windowHeight")
if not w and d.get("classicWindowsBefore"):
    import re; n=[float(x) for x in re.findall(r"[-\d.]+", d["classicWindowsBefore"][0])]; w,h=n[2],n[3]
print(int(w or 735), int(h or 615))' "$out/golden-classic.json")"
width="${size% *}"; height="${size#* }"
echo "Classic capture exit $classic; clone window ${width}x${height}"
backup="$(mktemp -d)"
state=("WebKit/com.sidwood.writer-classic" "WebKit/writer-classic" "Application Support/com.sidwood.writer-classic")
for item in "${state[@]}"; do
  [ -e "$HOME/Library/$item" ] && mkdir -p "$backup/$(dirname "$item")" && cp -a "$HOME/Library/$item" "$backup/$item"
done
WRITER_CLASSIC_NATIVE_SELFTEST="$out" WRITER_CLASSIC_GOLDEN_WIDTH="$width" WRITER_CLASSIC_GOLDEN_HEIGHT="$height" \
  WRITER_CLASSIC_GOLDEN_TEXT="$fixture" "$root/src-tauri/target/debug/writer-classic" >/dev/null 2>&1 &
pid=$!
for _ in $(seq 1 80); do
  sleep 0.5
  grep -q '"finished"' "$out/native-selftest.json" 2>/dev/null && break
done
kill "$pid" 2>/dev/null
sleep 1
kill -9 "$pid" 2>/dev/null
for item in "${state[@]}"; do
  if [ -e "$backup/$item" ]; then
    rm -rf "$HOME/Library/$item" && cp -a "$backup/$item" "$HOME/Library/$item"
  fi
done
rm -rf "$backup"
# The comparator must measure a same-origin capture as equal before its verdict counts.
swift "$root/scripts/classic-golden.swift" selfcheck "$out" || exit 1
swift "$root/scripts/classic-golden.swift" measure "$out"
