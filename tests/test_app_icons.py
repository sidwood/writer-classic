import pathlib
import struct
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri/icons"
LIGHT = ROOT / "brand/app-icon-light.icns"


class AppIconTest(unittest.TestCase):
    def test_static_icon_is_canonical_light(self):
        self.assertEqual((ICONS / "icon.icns").read_bytes(), LIGHT.read_bytes())
        self.assertFalse((ICONS / "icon.svg").exists())

    def test_generated_app_images_derive_from_light(self):
        with tempfile.TemporaryDirectory() as directory:
            master = pathlib.Path(directory) / "light.png"
            subprocess.run(["sips", "-s", "format", "png", str(LIGHT), "--out", str(master)], check=True, stdout=subprocess.DEVNULL)
            images = ["icon.png", "32x32.png", "64x64.png", "128x128.png", "128x128@2x.png"]
            images += [p.name for p in ICONS.glob("Square*Logo.png")]
            images += ["StoreLogo.png"]
            images += [str(p.relative_to(ICONS)) for p in ICONS.glob("android/mipmap-*/ic_launcher*.png")]
            for name in images:
                actual = ICONS / name
                width = subprocess.check_output(["sips", "-g", "pixelWidth", str(actual)], text=True).split("pixelWidth: ")[1].splitlines()[0]
                expected = pathlib.Path(directory) / "expected.png"
                subprocess.run(["sips", "-z", width, width, str(master), "--out", str(expected)], check=True, stdout=subprocess.DEVNULL)
                with self.subTest(name=name):
                    self.assertEqual(actual.read_bytes(), expected.read_bytes())

    def test_ios_images_derive_from_opaque_light(self):
        with tempfile.TemporaryDirectory() as directory:
            master = pathlib.Path(directory) / "light.png"
            opaque = pathlib.Path(directory) / "opaque.png"
            subprocess.run(["sips", "-s", "format", "png", str(LIGHT), "--out", str(master)], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["magick", str(master), "-background", "white", "-alpha", "remove", "-alpha", "off", "-strip", str(opaque)], check=True)
            for actual in sorted((ICONS / "ios").glob("AppIcon-*.png")):
                width = subprocess.check_output(["sips", "-g", "pixelWidth", str(actual)], text=True).split("pixelWidth: ")[1].splitlines()[0]
                expected = pathlib.Path(directory) / "expected.png"
                subprocess.run(["sips", "-z", width, width, str(opaque), "--out", str(expected)], check=True, stdout=subprocess.DEVNULL)
                with self.subTest(name=actual.name):
                    self.assertEqual(actual.read_bytes(), expected.read_bytes())

    def test_windows_frames_derive_from_light(self):
        ico = (ICONS / "icon.ico").read_bytes()
        count = struct.unpack_from("<H", ico, 4)[0]
        self.assertEqual(count, 6)
        with tempfile.TemporaryDirectory() as directory:
            master = pathlib.Path(directory) / "light.png"
            subprocess.run(["sips", "-s", "format", "png", str(LIGHT), "--out", str(master)], check=True, stdout=subprocess.DEVNULL)
            for index, size in enumerate([16, 24, 32, 48, 64, 256]):
                length, offset = struct.unpack_from("<II", ico, 6 + 16 * index + 8)
                expected = pathlib.Path(directory) / f"{size}.png"
                subprocess.run(["sips", "-z", str(size), str(size), str(master), "--out", str(expected)], check=True, stdout=subprocess.DEVNULL)
                with self.subTest(size=size):
                    self.assertEqual(ico[offset:offset + length], expected.read_bytes())


if __name__ == "__main__":
    unittest.main()
