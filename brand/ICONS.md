# Writer Classic icons

`app-icon-light.icns` and `app-icon-dark.icns` are the canonical application icons. The light icon is the static bundle default; the dark icon is used only when the user selects it. Keep both files unchanged. The separate Markdown document icon is generated from the document geometry in `build-icons.mjs`.

## Rebuild

```sh
node brand/build-icons.mjs
node brand/build-icons.mjs --masters <dir>
```

The generator extracts the 1024 px light image from the canonical ICNS with `sips`, copies that ICNS byte-for-byte to `src-tauri/icons/icon.icns`, and resizes the extracted image for the app PNGs, Windows ICO and tiles, iOS catalogue, and Android launchers. It does not generate application artwork. It uses `rsvg-convert`, `sips`, and `iconutil` for the separate document icon and `magick` to make opaque iOS images. `--masters` also retains the app and document 1024 px renders.

`src-tauri/tauri.conf.json` bundles `icons/icon.icns` and `icons/icon.png`. Runtime icon switching reads the canonical light and dark ICNS directly from `brand/`. The Markdown proxy SVG and PNG and document-type ICNS remain distinct: `src/App.vue` uses the first two, and the bundle uses the ICNS for Markdown files. Android's adaptive launcher XML and background colour are retained.
