# Writer Classic icons

All icon art is original. It is drawn from vector geometry in
`brand/build-icons.mjs`. No bytes, glyphs or outlines come from iA Writer
Classic, its app icon, or its `docicon-md.icns`. The installed app icon was
looked at only for general composition: a white card turned on a light ground,
a lowercase word, a tall caret in one accent colour.

## The marks

- **App icon:** a white paper card (`#ffffff` to `#f6f5f2`), its corners
  rounded to 0.045 of its side, turned 8° counter-clockwise with a soft shadow
  on a light warm-grey tile (`#ebe8e2` to `#dbd7cf`). The tile is the 824/1024
  macOS squircle grid body and the card stays inside it, so macOS 26 draws the
  icon natively rather than in its grey legacy frame. Centred on the card,
  `classic` is drawn as original monoline geometric strokes in graphite
  (`#2c2c2f`), not set in a font, and followed by a tall vermilion (`#e8553a`)
  caret.
- **Markdown document icon:** a portrait sheet with a flat folded corner and
  `md_` set in the same stroke and caret style.
- Sizes of 32 px and below use heavier-stroked masters so the marks stay
  legible.

## Rebuild

```sh
node brand/build-icons.mjs                    # regenerate every file below
node brand/build-icons.mjs --masters <dir>    # also keep the 1024 px renders
```

The script needs `rsvg-convert` to rasterise the SVG, `sips` to resize,
`iconutil` to build `.icns`, and `magick` to strip alpha from the iOS PNGs.
It writes the `.ico` container itself so every frame, including 256 px, is
PNG-compressed.

## Files

### Brand (`brand/`)

| File                          | Use                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `build-icons.mjs`             | Source of truth for all icon geometry and colours, and the build.                                                          |
| `markdown-document-icon.svg`  | Vector document icon. `src/App.vue` loads it for the browser-fallback title header.                                        |
| `markdown-document-icon.png`  | 512 px document icon. `src/App.vue` passes its bytes to the native title-bar proxy icon.                                   |
| `markdown-document-icon.icns` | macOS document-type icon for `.md` and the other markdown extensions. Contains 16 to 1024 px, with small sizes hand-tuned. |

This set does not wire the `.icns` into the bundle. For Finder to use it, the
bundle must copy it into `Contents/Resources`, and the markdown document type
must name it in `CFBundleTypeIconFile`.

### App (`src-tauri/icons/`)

| File                                                             | Use                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `icon.svg`                                                       | Vector master of the macOS app icon: 824 px body on a 1024 grid, baked shadow.                      |
| `icon.icns`                                                      | macOS app icon, named in `tauri.conf.json` `bundle.icon`. Has no 1x 16 or 32 px entries.            |
| `icon.png`                                                       | 512 px app icon, named in `bundle.icon`. Also used as the Linux and window icon.                    |
| `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`        | Linux bundle sizes, macOS grid.                                                                     |
| `icon.ico`                                                       | Windows app icon, with 16, 24, 32, 48, 64 and 256 px frames. Flat tile, no outer shadow.            |
| `Square30x30Logo.png` … `Square310x310Logo.png`, `StoreLogo.png` | Windows Store and Start tile logos. Flat tile.                                                      |
| `ios/AppIcon-*.png`                                              | iOS asset catalogue. Opaque full-bleed squares, because iOS applies its own mask and rejects alpha. |
| `android/mipmap-*/ic_launcher.png`                               | Android legacy square launcher icon.                                                                |
| `android/mipmap-*/ic_launcher_round.png`                         | Android legacy round launcher icon.                                                                 |
| `android/mipmap-*/ic_launcher_foreground.png`                    | Android adaptive-icon foreground. Transparent, with the card and mark inside the 66 dp safe zone.   |
| `android/values/ic_launcher_background.xml`                      | Android adaptive-icon background colour (`#e3e0d9`).                                                |

`icon.icns` leaves out the 1x 16 and 32 px entries. When macOS 26 draws a
legacy icon from those entries, it puts the icon in its grey box, even when the
art fits the grid. Without them, it scales the @2x entries down and draws the
icon natively at every size.

`android/mipmap-anydpi-v26/ic_launcher.xml` is unchanged. It still points the
adaptive icon at the foreground and background above.
