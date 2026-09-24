#!/usr/bin/env node
// Builds every Writer Classic icon from the vector geometry in this file.
//
//   node brand/build-icons.mjs
//
// Needs rsvg-convert (SVG -> PNG), sips (resizing), iconutil (.icns) and
// ImageMagick's magick (stripping alpha from the iOS set). All art is original: a
// lowercase monoline "w" followed by a vermilion underscore caret, on a warm
// light tile. The document icon reuses the same stroke language as "md_".
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(root, "brand");
const icons = join(root, "src-tauri", "icons");
const work = mkdtempSync(join(tmpdir(), "writer-classic-icons-"));

const INK = "#2c2c2f";
const ACCENT = "#e8553a";
const TILE_TOP = "#fcfbf8";
const TILE_BOTTOM = "#ebe8e2";
const TILE_FLAT = "#f4f2ed";

const n = (value) => +value.toFixed(2);

// ---------------------------------------------------------------- app mark

// The underscore caret, sitting on the baseline like a text cursor.
function caret(x, base, weight, length) {
  const height = weight * 0.72;
  const y = base + weight / 2 - height;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(length)}" height="${n(height)}" rx="${n(height * 0.24)}" fill="${ACCENT}"/>`;
}

// The mark in tile space: an 824-unit square, the macOS icon grid's body.
// `weight` is the stroke width; the small-size variant thickens it.
function appMark(weight) {
  const height = 250;
  const width = 350;
  const middle = height * 0.24;
  const gap = 34;
  const caretLength = 150;
  const visualWidth = weight + width + gap + caretLength;
  const left = 412 - visualWidth / 2 + weight / 2;
  const top = 412 - (height + weight) / 2 - 10 + weight / 2;
  const base = top + height;
  const points = [
    [0, top],
    [width / 4, base],
    [width / 2, top + middle],
    [(3 * width) / 4, base],
    [width, top],
  ].map(([x, y]) => `${n(left + x)} ${n(y)}`);
  return `<path d="M${points.join(" L")}" fill="none" stroke="${INK}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round"/>
  ${caret(left + width + weight / 2 + gap, base, weight, caretLength)}`;
}

const tileGradient = `<linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TILE_TOP}"/><stop offset="1" stop-color="${TILE_BOTTOM}"/></linearGradient>`;

// macOS: 824 body on a 1024 canvas, 185 corner radius, baked drop shadow.
function macAppIcon(weight, shadowOpacity) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    ${tileGradient}
    <filter id="blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <rect x="100" y="110" width="824" height="824" rx="185" fill="#000" fill-opacity="${shadowOpacity}" filter="url(#blur)"/>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#tile)"/>
  <rect x="101" y="101" width="822" height="822" rx="184" fill="none" stroke="#000" stroke-opacity=".07" stroke-width="2"/>
  <g transform="translate(100 100)">
  ${appMark(weight)}
  </g>
</svg>
`;
}

// Windows and Android legacy: the tile nearly fills the canvas, no shadow.
function flatAppIcon(weight, shape) {
  const body =
    shape === "circle"
      ? `<circle cx="512" cy="512" r="508" fill="url(#tile)"/>
  <circle cx="512" cy="512" r="507" fill="none" stroke="#000" stroke-opacity=".07" stroke-width="2"/>`
      : `<rect x="16" y="16" width="992" height="992" rx="200" fill="url(#tile)"/>
  <rect x="17" y="17" width="990" height="990" rx="199" fill="none" stroke="#000" stroke-opacity=".07" stroke-width="2"/>`;
  const scale = shape === "circle" ? 0.92 : 992 / 824;
  const offset = 512 - 412 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${tileGradient}</defs>
  ${body}
  <g transform="translate(${n(offset)} ${n(offset)}) scale(${n(scale)})">
  ${appMark(weight)}
  </g>
</svg>
`;
}

// iOS masks the corners itself and rejects alpha, so fill the whole square.
function fullBleedAppIcon() {
  const scale = 1024 / 824;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${tileGradient}</defs>
  <rect width="1024" height="1024" fill="url(#tile)"/>
  <g transform="scale(${n(scale)})">
  ${appMark(62)}
  </g>
</svg>
`;
}

// Android adaptive foreground: 108dp canvas, mark kept inside the 66dp circle.
function androidForeground() {
  const scale = 0.8;
  const offset = 512 - 412 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(${n(offset)} ${n(offset)}) scale(${scale})">
  ${appMark(66)}
  </g>
</svg>
`;
}

// ------------------------------------------------------- markdown document

// Lowercase monoline "md" plus the caret, centred on (cx, cy) and drawn at
// `scale` so the letter proportions stay fixed while the size changes.
function mdMark(cx, cy, weight, scale) {
  const w = weight / scale;
  const height = 156;
  const arch = 58;
  const bowl = height / 2;
  const ascender = 110;
  const mToD = w + 40;
  const gap = 30;
  const caretLength = 110;
  const mWidth = 4 * arch;
  const visualWidth = w + mWidth + mToD + 2 * bowl + w / 2 + gap + caretLength;
  const left = -visualWidth / 2 + w / 2;
  const top = -(height + w) / 2 + ascender / 2 + w / 2;
  const base = top + height;
  const archTop = top + arch;
  const m = [
    `M${n(left)} ${n(base)} V${n(archTop)}`,
    `A${arch} ${arch} 0 0 1 ${n(left + 2 * arch)} ${n(archTop)} V${n(base)}`,
    `M${n(left + 2 * arch)} ${n(archTop)}`,
    `A${arch} ${arch} 0 0 1 ${n(left + 4 * arch)} ${n(archTop)} V${n(base)}`,
  ].join(" ");
  const stemX = left + mWidth + mToD + 2 * bowl;
  const d = `M${n(stemX)} ${n(top - ascender)} V${n(base)} M${n(stemX)} ${n(top + bowl)} A${bowl} ${bowl} 0 1 0 ${n(stemX)} ${n(top + bowl + 0.01)}`;
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">
  <path d="${m} ${d}" fill="none" stroke="${INK}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>
  ${caret(stemX + w / 2 + gap, base, w, caretLength)}
  </g>`;
}

// A portrait sheet with a flat folded corner, on the macOS 1024 canvas.
function documentIcon(weight, scale) {
  const [left, right, top, bottom] = [176, 848, 64, 952];
  const radius = 40;
  const fold = 214;
  const foldRadius = 26;
  const page = `M${left + radius} ${top} H${right - fold} L${right} ${top + fold} V${bottom - radius} A${radius} ${radius} 0 0 1 ${right - radius} ${bottom} H${left + radius} A${radius} ${radius} 0 0 1 ${left} ${bottom - radius} V${top + radius} A${radius} ${radius} 0 0 1 ${left + radius} ${top} Z`;
  const flap = `M${right - fold} ${top} V${top + fold - foldRadius} A${foldRadius} ${foldRadius} 0 0 0 ${right - fold + foldRadius} ${top + fold} H${right} Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="sheet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1efea"/></linearGradient>
    <linearGradient id="flap" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#e4e0d9"/><stop offset="1" stop-color="#f8f7f4"/></linearGradient>
    <filter id="blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="flapBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>
    <clipPath id="page"><path d="${page}"/></clipPath>
  </defs>
  <path d="${page}" transform="translate(0 8)" fill="#000" fill-opacity=".28" filter="url(#blur)"/>
  <path d="${page}" fill="url(#sheet)"/>
  <path d="${page}" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="2"/>
  <g clip-path="url(#page)"><path d="${flap}" transform="translate(-8 10)" fill="#000" fill-opacity=".16" filter="url(#flapBlur)"/></g>
  <path d="${flap}" fill="url(#flap)"/>
  <path d="${flap}" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="2" stroke-linejoin="round"/>
  ${mdMark(512, 600, weight, scale)}
</svg>
`;
}

// ------------------------------------------------------------------ output

function writeSvg(name, svg) {
  const path = join(work, `${name}.svg`);
  writeFileSync(path, svg);
  return path;
}

function run(command, args) {
  execFileSync(command, args, { stdio: ["ignore", "ignore", "inherit"] });
}

// Rasterise at 1024 once, then let sips downsample to each target size.
function master(name, svg) {
  const png = join(work, `${name}.png`);
  run("rsvg-convert", [
    "-w",
    "1024",
    "-h",
    "1024",
    "-o",
    png,
    writeSvg(name, svg),
  ]);
  return png;
}

function resize(source, size, out) {
  mkdirSync(dirname(out), { recursive: true });
  run("sips", ["-z", String(size), String(size), source, "--out", out]);
}

// An .ico whose entries are all PNG, as Windows Vista and later read them.
// ImageMagick would store the 256 px frame as an uncompressed bitmap.
function ico(frames, out) {
  const images = frames.map(([size, path]) => [size, readFileSync(path)]);
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([size, png], index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  writeFileSync(out, Buffer.concat([header, ...images.map(([, png]) => png)]));
}

// Sizes of 32 px and below come from the heavier-stroked small master.
function iconset(name, regular, small, out) {
  const set = join(work, `${name}.iconset`);
  mkdirSync(set);
  for (const base of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = base * scale;
      const suffix = scale === 2 ? "@2x" : "";
      resize(
        px <= 32 ? small : regular,
        px,
        join(set, `icon_${base}x${base}${suffix}.png`),
      );
    }
  }
  run("iconutil", ["-c", "icns", set, "-o", out]);
}

const macRegular = master("mac", macAppIcon(62, 0.3));
const macSmall = master("mac-small", macAppIcon(84, 0.22));
const flatRegular = master("flat", flatAppIcon(62, "square"));
const flatSmall = master("flat-small", flatAppIcon(84, "square"));
const round = master("round", flatAppIcon(62, "circle"));
const iosMaster = master("ios", fullBleedAppIcon());
const foreground = master("foreground", androidForeground());
const docRegular = master("doc", documentIcon(38, 0.76));
const docSmall = master("doc-small", documentIcon(54, 0.8));

// Vector sources other code loads directly.
writeFileSync(join(icons, "icon.svg"), macAppIcon(62, 0.3));
writeFileSync(
  join(brand, "markdown-document-icon.svg"),
  documentIcon(38, 0.76),
);

// macOS bundle and the generic PNG set Tauri reads.
iconset("app", macRegular, macSmall, join(icons, "icon.icns"));
resize(macRegular, 512, join(icons, "icon.png"));
resize(macSmall, 32, join(icons, "32x32.png"));
resize(macRegular, 64, join(icons, "64x64.png"));
resize(macRegular, 128, join(icons, "128x128.png"));
resize(macRegular, 256, join(icons, "128x128@2x.png"));

// Windows: multi-size .ico plus the Store/tile logos.
const icoFrames = [16, 24, 32, 48, 64, 256].map((size) => {
  const out = join(work, `ico-${size}.png`);
  resize(size <= 32 ? flatSmall : flatRegular, size, out);
  return [size, out];
});
ico(icoFrames, join(icons, "icon.ico"));
for (const size of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
  resize(
    size <= 44 ? flatSmall : flatRegular,
    size,
    join(icons, `Square${size}x${size}Logo.png`),
  );
}
resize(flatRegular, 50, join(icons, "StoreLogo.png"));

// iOS: opaque full-bleed squares, sizes matching the Xcode asset catalogue.
const iosOpaque = join(work, "ios-opaque.png");
run("magick", [iosMaster, "-alpha", "remove", "-alpha", "off", iosOpaque]);
const iosSizes = {
  "AppIcon-20x20@1x.png": 20,
  "AppIcon-20x20@2x.png": 40,
  "AppIcon-20x20@2x-1.png": 40,
  "AppIcon-20x20@3x.png": 60,
  "AppIcon-29x29@1x.png": 29,
  "AppIcon-29x29@2x.png": 58,
  "AppIcon-29x29@2x-1.png": 58,
  "AppIcon-29x29@3x.png": 87,
  "AppIcon-40x40@1x.png": 40,
  "AppIcon-40x40@2x.png": 80,
  "AppIcon-40x40@2x-1.png": 80,
  "AppIcon-40x40@3x.png": 120,
  "AppIcon-60x60@2x.png": 120,
  "AppIcon-60x60@3x.png": 180,
  "AppIcon-76x76@1x.png": 76,
  "AppIcon-76x76@2x.png": 152,
  "AppIcon-83.5x83.5@2x.png": 167,
  "AppIcon-512@2x.png": 1024,
};
for (const [file, size] of Object.entries(iosSizes)) {
  resize(iosOpaque, size, join(icons, "ios", file));
}

// Android: legacy square and round launchers, plus the adaptive foreground.
const androidSizes = {
  mdpi: [48, 108],
  hdpi: [49, 162],
  xhdpi: [96, 216],
  xxhdpi: [144, 324],
  xxxhdpi: [192, 432],
};
for (const [density, [launcher, adaptive]] of Object.entries(androidSizes)) {
  const dir = join(icons, "android", `mipmap-${density}`);
  resize(flatRegular, launcher, join(dir, "ic_launcher.png"));
  resize(round, launcher, join(dir, "ic_launcher_round.png"));
  resize(foreground, adaptive, join(dir, "ic_launcher_foreground.png"));
}
writeFileSync(
  join(icons, "android", "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">${TILE_FLAT}</color>\n</resources>\n`,
);

// Markdown document: title-bar proxy PNG and the .md document-type icon.
resize(docRegular, 512, join(brand, "markdown-document-icon.png"));
iconset(
  "document",
  docRegular,
  docSmall,
  join(brand, "markdown-document-icon.icns"),
);

// `--masters <dir>` keeps the 1024 px renders for review.
const mastersFlag = process.argv.indexOf("--masters");
if (mastersFlag !== -1) {
  const keep = process.argv[mastersFlag + 1];
  mkdirSync(keep, { recursive: true });
  for (const name of [
    "mac",
    "mac-small",
    "flat",
    "flat-small",
    "round",
    "ios",
    "foreground",
    "doc",
    "doc-small",
  ]) {
    copyFileSync(join(work, `${name}.png`), join(keep, `${name}.png`));
  }
}
rmSync(work, { recursive: true, force: true });
