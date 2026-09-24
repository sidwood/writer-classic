"""Verify the built Apple Silicon bundle and original document icon wiring."""
import pathlib
import plistlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent.parent
bundle = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Writer Classic.app"
with (bundle / "Contents/Info.plist").open("rb") as stream:
    info = plistlib.load(stream)
executable = bundle / "Contents/MacOS" / info["CFBundleExecutable"]
architecture = subprocess.check_output(["file", str(executable)], text=True)
assert "Mach-O 64-bit executable arm64" in architecture, architecture
markdown = next(entry for entry in info["CFBundleDocumentTypes"] if entry["CFBundleTypeName"] == "Markdown")
assert markdown["CFBundleTypeRole"] == "Editor"
assert "LSHandlerRank" not in markdown
classic = {"md", "markdown", "mmd", "multimarkdown", "mdown", "mkdn", "mkd", "mdwn", "mdtxt", "mdtext", "mdml"}
assert classic.issubset(set(markdown["CFBundleTypeExtensions"]))
assert "com.sidwood.writer-classic.markdown" in markdown["LSItemContentTypes"]
assert markdown["CFBundleTypeIconFile"] == "markdown-document-icon.icns"
exported = next(entry for entry in info["UTExportedTypeDeclarations"] if entry["UTTypeIdentifier"] == "com.sidwood.writer-classic.markdown")
imported = next(entry for entry in info["UTImportedTypeDeclarations"] if entry["UTTypeIdentifier"] == "net.daringfireball.markdown")
assert exported["UTTypeIconFile"] == "markdown-document-icon"
assert imported["UTTypeIconFile"] == "markdown-document-icon"
assert classic.issubset(set(exported["UTTypeTagSpecification"]["public.filename-extension"]))
assert (bundle / "Contents/Resources/markdown-document-icon.icns").read_bytes() == (root / "brand/markdown-document-icon.icns").read_bytes()
assert (bundle / "Contents/Resources/icon.icns").read_bytes() == (root / "src-tauri/icons/icon.icns").read_bytes()
assert info["NSAppleScriptEnabled"] is True
assert info["OSAScriptingDefinition"] == "WriterClassic.sdef"
assert info["CFBundleHelpBookFolder"] == "WriterClassicHelp"
assert info["CFBundleHelpBookName"] == "com.sidwood.writer-classic.help"
sdef = (bundle / "Contents/Resources/WriterClassic.sdef").read_text()
assert "front document" in sdef and "ClassicOpenCommand" in sdef
help_page = bundle / "Contents/Resources/WriterClassicHelp/Contents/Resources/en.lproj/index.html"
assert "Writer Classic Help" in help_page.read_text()
assert (bundle / "Contents/Resources/WriterClassicHelp/WriterClassicHelp.helpindex").stat().st_size > 0
generator = bundle / "Contents/Library/QuickLook/Writer Classic.qlgenerator"
assert (generator / "Contents/MacOS/WriterClassicQL").is_file()
ql_info = plistlib.load((generator / "Contents/Info.plist").open("rb"))
types = ql_info["CFBundleDocumentTypes"][0]["LSItemContentTypes"]
assert "public.plain-text" in types and "net.daringfireball.markdown" in types
preview = bundle / "Contents/PlugIns/WriterClassicPreview.appex"
assert (preview / "Contents/MacOS/WriterClassicPreview").is_file()
print("PASS: arm64 Mach-O executable; Markdown association; Quick Look generator; help book; AppleScript definition; document and app icon bytes match handed-off assets.")
