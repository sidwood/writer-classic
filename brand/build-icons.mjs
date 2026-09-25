#!/usr/bin/env node
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
// The cursor gradient in the canonical app icons, top to bottom.
const ACCENT_TOP = "#58a4f5";
const ACCENT_BOTTOM = "#3a86e8";

const n = (value) => +value.toFixed(2);

function caret(x, base, weight, length) {
  const height = weight * 0.72;
  const y = base + weight / 2 - height;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(length)}" height="${n(height)}" rx="${n(height * 0.24)}" fill="url(#caret)"/>`;
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
    <linearGradient id="caret" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ACCENT_TOP}"/><stop offset="1" stop-color="${ACCENT_BOTTOM}"/></linearGradient>
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

function iconset(name, regular, small, out) {
  const set = join(work, `${name}.iconset`);
  mkdirSync(set);
  for (const base of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = base * scale;
      const suffix = scale === 2 ? "@2x" : "";
      const file = `icon_${base}x${base}${suffix}.png`;
      resize(px <= 32 ? small : regular, px, join(set, file));
    }
  }
  run("iconutil", ["-c", "icns", set, "-o", out]);
}

const light = join(brand, "app-icon-light.icns");
const app = join(work, "app.png");
run("sips", ["-s", "format", "png", light, "--out", app]);
copyFileSync(light, join(icons, "icon.icns"));
const docRegular = master("doc", documentIcon(38, 0.76));
const docSmall = master("doc-small", documentIcon(54, 0.8));
writeFileSync(join(brand, "markdown-document-icon.svg"), documentIcon(38, 0.76));
for (const [file, size] of Object.entries({
  "icon.png": 512,
  "32x32.png": 32,
  "64x64.png": 64,
  "128x128.png": 128,
  "128x128@2x.png": 256,
})) resize(app, size, join(icons, file));

const icoFrames = [16, 24, 32, 48, 64, 256].map((size) => {
  const out = join(work, `ico-${size}.png`);
  resize(app, size, out);
  return [size, out];
});
ico(icoFrames, join(icons, "icon.ico"));
for (const size of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
  resize(app, size, join(icons, `Square${size}x${size}Logo.png`));
}
resize(app, 50, join(icons, "StoreLogo.png"));

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
const iosOpaque = join(work, "ios-opaque.png");
run("magick", [app, "-background", "white", "-alpha", "remove", "-alpha", "off", "-strip", iosOpaque]);
for (const [file, size] of Object.entries(iosSizes)) {
  resize(iosOpaque, size, join(icons, "ios", file));
}

const androidSizes = {
  mdpi: [48, 108],
  hdpi: [49, 162],
  xhdpi: [96, 216],
  xxhdpi: [144, 324],
  xxxhdpi: [192, 432],
};
for (const [density, [launcher, adaptive]] of Object.entries(androidSizes)) {
  const dir = join(icons, "android", `mipmap-${density}`);
  resize(app, launcher, join(dir, "ic_launcher.png"));
  resize(app, launcher, join(dir, "ic_launcher_round.png"));
  resize(app, adaptive, join(dir, "ic_launcher_foreground.png"));
}
// Markdown document: title-bar proxy PNG and the .md document-type icon.
resize(docRegular, 512, join(brand, "markdown-document-icon.png"));
iconset(
  "document",
  docRegular,
  docSmall,
  join(brand, "markdown-document-icon.icns"),
);

const mastersFlag = process.argv.indexOf("--masters");
if (mastersFlag !== -1) {
  const keep = process.argv[mastersFlag + 1];
  mkdirSync(keep, { recursive: true });
  for (const name of ["app", "doc", "doc-small"]) {
    copyFileSync(join(work, `${name}.png`), join(keep, `${name}.png`));
  }
}
rmSync(work, { recursive: true, force: true });
