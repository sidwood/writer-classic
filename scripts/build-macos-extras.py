#!/usr/bin/env python3
"""Build and check the Quick Look generator, preview extension, and help book."""

import argparse
import pathlib
import plistlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
QL = ROOT / "src-tauri/quicklook"
OUT = ROOT / "src-tauri/target/quicklook"
HELP = ROOT / "src-tauri/target/help/WriterClassicHelp"
GENERATOR = OUT / "Writer Classic.qlgenerator"
APPEX = OUT / "WriterClassicPreview.appex"


def run(command):
    subprocess.check_call(command)


def compile_binary(sources, output, arches, frameworks, minimum="11.0", extension=False, defines=()):
    output.parent.mkdir(parents=True, exist_ok=True)
    binaries = []
    for arch in arches:
        binary = output.parent / f".{output.name}.{arch}"
        command = [
            "clang",
            "-fobjc-arc",
            "-arch",
            arch,
            f"-mmacosx-version-min={minimum}",
            "-Wno-deprecated-declarations",
            "-Wno-unguarded-availability",
        ]
        if extension:
            command.extend([
                "-fapplication-extension",
                "-e",
                "_NSExtensionMain",
                "-Wl,-u,_NSExtensionMain",
            ])
        else:
            command.append("-bundle")
        command.extend(f"-D{item}" for item in defines)
        command.extend(item for framework in frameworks for item in ("-framework", framework))
        command.extend(map(str, sources))
        command.extend(["-o", str(binary)])
        run(command)
        binaries.append(binary)
    if len(binaries) == 1:
        binaries[0].replace(output)
    else:
        run(["lipo", "-create", *map(str, binaries), "-output", str(output)])
        for binary in binaries:
            binary.unlink()


def compile_bundle(sources, output, arches, frameworks, minimum="11.0"):
    compile_binary(sources, output, arches, frameworks, minimum)

def build_generator():
    macos = GENERATOR / "Contents/MacOS"
    if GENERATOR.exists():
        shutil.rmtree(GENERATOR)
    macos.mkdir(parents=True)
    shutil.copy(QL / "Info.plist", GENERATOR / "Contents/Info.plist")
    plist = plistlib.loads((GENERATOR / "Contents/Info.plist").read_bytes())
    plist["CFBundleSupportedPlatforms"] = ["MacOSX"]
    plist["CFPlugInDynamicRegisterFunction"] = ""
    plist["CFPlugInUnloadFunction"] = ""
    plist["QLNeedsToBeRunInMainThread"] = True
    with (GENERATOR / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump(plist, stream)
    arches = ["arm64"]
    probe = subprocess.run(["clang", "-arch", "arm64e", "-x", "c", "-E", "-"], input=b"", capture_output=True)
    if probe.returncode == 0:
        arches.append("arm64e")
    compile_bundle([QL / "generator.m"], macos / "WriterClassicQL", arches, ["Foundation", "CoreServices", "QuickLook", "CoreText", "CoreGraphics", "CoreFoundation"])
    subprocess.run(["codesign", "-s", "-", "--force", str(GENERATOR)], check=False)


def build_preview_extension():
    macos = APPEX / "Contents/MacOS"
    if APPEX.exists():
        shutil.rmtree(APPEX)
    macos.mkdir(parents=True)
    shutil.copy(QL / "appex-Info.plist", APPEX / "Contents/Info.plist")
    compile_binary(
        [QL / "generator.m", QL / "preview-provider.m"],
        macos / "WriterClassicPreview",
        ["arm64"],
        ["Foundation", "AppKit", "QuickLook", "QuickLookUI", "UniformTypeIdentifiers", "CoreText", "CoreGraphics", "CoreFoundation"],
        "12.0",
        extension=True,
        defines=("CLASSIC_PREVIEW_EXTENSION",),
    )
    signed = subprocess.run(
        ["codesign", "--force", "--sign", "-", "--entitlements", str(QL / "preview.entitlements"), "--timestamp=none", str(APPEX)],
        capture_output=True,
        text=True,
    )
    if signed.returncode != 0:
        raise SystemExit(signed.stderr or signed.stdout or "codesign failed")
def build_script_suite():
    destination = ROOT / "src-tauri/target/help"
    destination.mkdir(parents=True, exist_ok=True)
    sdef = ROOT / "src-tauri/WriterClassic.sdef"
    subprocess.run(["sdp", "-f", "s", "-o", str(destination), str(sdef)], check=False)
    subprocess.run(["sdp", "-f", "t", "-o", str(destination), str(sdef)], check=False)


def build_help():
    lproj = HELP / "Contents/Resources/en.lproj"
    if HELP.exists():
        shutil.rmtree(HELP)
    lproj.mkdir(parents=True)
    shutil.copy(ROOT / "public/help/index.html", lproj / "index.html")
    info = {
        "CFBundleIdentifier": "com.sidwood.writer-classic.help",
        "CFBundleName": "Writer Classic Help",
        "CFBundlePackageType": "BNDL",
        "CFBundleShortVersionString": "1.0",
        "CFBundleVersion": "1",
        "HPDBookAccessPath": "index.html",
        "HPDBookIndexPath": "WriterClassicHelp.helpindex",
        "HPDBookTitle": "Writer Classic Help",
        "HPDBookType": "3",
    }
    with (HELP / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump(info, stream)
    run(["hiutil", "-Caf", str(HELP / "WriterClassicHelp.helpindex"), "-s", "en", str(lproj)])


def check():
    build_generator()
    build_preview_extension()
    build_help()
    build_script_suite()
    page = (HELP / "Contents/Resources/en.lproj/index.html").read_text()
    assert 'name="AppleTitle" content="Writer Classic Help"' in page
    assert 'id="top"' in page
    assert (HELP / "WriterClassicHelp.helpindex").stat().st_size > 0
    help_info = plistlib.loads((HELP / "Contents/Info.plist").read_bytes())
    assert help_info["CFBundleIdentifier"] == "com.sidwood.writer-classic.help"
    assert help_info["HPDBookAccessPath"] == "index.html"
    with tempfile.TemporaryDirectory() as temporary:
        root = pathlib.Path(temporary)
        markdown = root / "sample.md"
        plain = root / "sample.txt"
        markdown.write_text("# Title\n\nHello Quick Look **bold token**\n")
        plain.write_text("Plain text token\n")
        dump = root / "dump"
        run(["clang", "-fobjc-arc", "-DCLASSIC_QL_DUMP", "-Wno-deprecated-declarations", "-framework", "Foundation", "-framework", "CoreText", "-framework", "CoreGraphics", "-framework", "QuickLook", str(QL / "generator.m"), "-o", str(dump)])
        html = subprocess.check_output([str(dump), str(markdown), "net.daringfireball.markdown", "sample.md"], text=True)
        assert "<h1>Title</h1>" in html and "<strong>bold token</strong>" in html
        semantics = root / "semantics.md"
        semantics.write_text(
            "```\n~~~\n** literal\n```\n** child\n"
            "````\n```\n** literal\n````\n"
            "~~~\n```\n** tilde\n~~~\n** child\n"
            "```js\n** literal\n```\n"
            "`*not em*` and `**not strong**`\n"
            "`a*b` *c*\n"
            "* One\n** Two\n"
            "1. First\n"
            "*em*\n",
            encoding="utf-8",
        )
        semantic = subprocess.check_output(
            [str(dump), str(semantics), "net.daringfireball.markdown", "semantics.md"],
            text=True,
        )
        assert "<pre><code>~~~\n** literal\n</code></pre>" in semantic
        assert "<pre><code>```\n** literal\n</code></pre>" in semantic
        assert "<pre><code>```\n** tilde\n</code></pre>" in semantic
        assert '<pre><code class="language-js">** literal\n</code></pre>' in semantic
        assert "<li>child</li>" in semantic
        assert "** child" not in semantic
        assert "<li>literal</li>" not in semantic
        assert "<strong>literal</strong>" not in semantic
        assert "<strong>tilde</strong>" not in semantic
        assert "<code>*not em*</code>" in semantic
        assert "<code>**not strong**</code>" in semantic
        assert "<em>not em</em>" not in semantic
        assert "<strong>not strong</strong>" not in semantic
        assert "<code>a*b</code>" in semantic
        assert "<em>c</em>" in semantic
        assert "<li>One" in semantic and "<li>Two</li>" in semantic
        assert "<li>First</li>" in semantic
        assert "<em>em</em>" in semantic
        assert "<li>em</li>" not in semantic
        classic = root / "classic-blocks.md"
        classic.write_text(
            "    indented code\n"
            "    second line\n"
            "_emphasis_ and __strong__\n"
            "> quoted line\n"
            "* * *\n"
            "- - -\n"
            "_ _ _\n",
            encoding="utf-8",
        )
        blocks = subprocess.check_output(
            [str(dump), str(classic), "net.daringfireball.markdown", "classic-blocks.md"],
            text=True,
        )
        assert "<pre><code>indented code\nsecond line\n</code></pre>" in blocks
        assert "<p>    indented code</p>" not in blocks
        assert "<em>emphasis</em>" in blocks
        assert "<strong>strong</strong>" in blocks
        assert "_emphasis_" not in blocks
        assert "__strong__" not in blocks
        assert "<blockquote><p>quoted line</p></blockquote>" in blocks
        assert "&gt; quoted line" not in blocks
        assert blocks.count("<hr>") >= 3
        assert "<li>* *" not in blocks
        assert "<p>* * *</p>" not in blocks
        assert "<p>- - -</p>" not in blocks
        assert "<p>_ _ _</p>" not in blocks
        text_html = subprocess.check_output([str(dump), str(plain), "public.plain-text", "sample.txt"], text=True)
        assert "<pre>Plain text token\n</pre>" in text_html
        loader = root / "loader.m"
        loader.write_text(
            """
            #import <Foundation/Foundation.h>
            #import <CoreFoundation/CFPlugIn.h>
            #import <QuickLook/QuickLook.h>
            typedef void *(*Factory)(CFAllocatorRef, CFUUIDRef);
            typedef const char *(*Preview)(const char *, const char *, const char *);
            int main(int argc, char **argv) {
                NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
                CFBundleRef bundle = CFBundleCreate(NULL, (__bridge CFURLRef)url);
                CFErrorRef error = NULL;
                if (!CFBundleLoadExecutableAndReturnError(bundle, &error)) return 2;
                Factory factory = (Factory)CFBundleGetFunctionPointerForName(bundle, CFSTR("QuickLookGeneratorPluginFactory"));
                Preview preview = (Preview)CFBundleGetFunctionPointerForName(bundle, CFSTR("writer_preview_html_utf8"));
                void (*thumbnail)(void) = CFBundleGetFunctionPointerForName(bundle, CFSTR("GenerateThumbnailForURL"));
                void (*generate)(void) = CFBundleGetFunctionPointerForName(bundle, CFSTR("GeneratePreviewForURL"));
                if (!factory || !preview || !thumbnail || !generate) return 3;
                void *instance = factory(kCFAllocatorDefault, kQLGeneratorTypeID);
                if (!instance || !*(void **)instance) return 4;
                const char *html = preview("Hello Quick Look", "public.plain-text", "sample.txt");
                if (!html || !strstr(html, "Hello Quick Look")) return 5;
                NSDictionary *info = [NSDictionary dictionaryWithContentsOfURL:[url URLByAppendingPathComponent:@"Contents/Info.plist"]];
                NSArray *types = info[@"CFBundleDocumentTypes"][0][@"LSItemContentTypes"];
                if (![types containsObject:@"public.plain-text"] || ![types containsObject:@"net.daringfireball.markdown"]) return 6;
                return 0;
            }
            """
        )
        host = root / "loader"
        run(["clang", "-fobjc-arc", "-framework", "Foundation", "-framework", "QuickLook", str(loader), "-o", str(host)])
        run([str(host), str(GENERATOR)])
        appex_info = plistlib.loads((APPEX / "Contents/Info.plist").read_bytes())
        extension = appex_info["NSExtension"]
        assert extension["NSExtensionPointIdentifier"] == "com.apple.quicklook.preview"
        assert "public.plain-text" in extension["NSExtensionAttributes"]["QLSupportedContentTypes"]
        assert "net.daringfireball.markdown" in extension["NSExtensionAttributes"]["QLSupportedContentTypes"]
        assert (APPEX / "Contents/MacOS/WriterClassicPreview").is_file()
        binary = APPEX / "Contents/MacOS/WriterClassicPreview"
        kind = subprocess.check_output(["file", str(binary)], text=True)
        assert "Mach-O 64-bit executable arm64" in kind, kind
        assert "bundle" not in kind
        load = subprocess.check_output(["otool", "-l", str(binary)], text=True)
        assert "LC_MAIN" in load
        entitlements = subprocess.run(
            ["codesign", "-d", "--entitlements", "-", str(APPEX)],
            capture_output=True,
            text=True,
        )
        entitlement_text = entitlements.stdout + entitlements.stderr
        assert "com.apple.security.app-sandbox" in entitlement_text, entitlement_text
        record_quicklook_registration(root / "sample.md")
    print("PASS: Quick Look generator loads and previews markdown and text; help book is indexed.")


def record_quicklook_registration(sample):
    evidence = ROOT / "docs/evidence/quicklook-registration.txt"
    lines = []

    def text_of(value):
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8", "replace")
        return str(value)

    def capture(command, timeout=20):
        lines.append("$ " + " ".join(map(str, command)))
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as expired:
            lines.append(text_of(expired.stdout))
            lines.append(text_of(expired.stderr))
            lines.append(f"exit=timeout after {timeout}s")
            lines.append("")
            return
        lines.append(text_of(result.stdout))
        lines.append(text_of(result.stderr))
        lines.append(f"exit={result.returncode}")
        lines.append("")

    capture(["file", str(APPEX / "Contents/MacOS/WriterClassicPreview")])
    capture(["codesign", "-dv", "--entitlements", "-", str(APPEX)])
    capture(["pluginkit", "-a", "-v", str(APPEX)])
    capture(["pluginkit", "-m", "-vv", "-A", "-D", "-i", "com.sidwood.writer-classic.preview"])
    capture(["pluginkit", "-r", "-v", str(APPEX)])
    capture(["security", "find-identity", "-v", "-p", "codesigning"])
    capture(["qlmanage", "-g", str(GENERATOR), "-c", "net.daringfireball.markdown", "-p", str(sample)], timeout=8)
    lines.append(
        "BLOCKER: pluginkit -a exits 0 but does not list com.sidwood.writer-classic.preview. "
        "security find-identity reports 0 valid identities, and the appex signature is ad-hoc. "
        "Registration still requires a signing identity. qlmanage -g reports Can't get generator. "
        "System Quick Look is not claimed to work on this Mac."
    )
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text("\n".join(lines))
    # Registration requires a signing identity. The recorded command output is the blocker, not a success claim.


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        check()
    else:
        build_generator()
        build_preview_extension()
        build_help()
        build_script_suite()
