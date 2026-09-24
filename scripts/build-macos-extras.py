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


def compile_bundle(sources, output, arches, frameworks, minimum="11.0"):
    output.parent.mkdir(parents=True, exist_ok=True)
    binaries = []
    for arch in arches:
        binary = output.parent / f".{output.name}.{arch}"
        command = [
            "clang",
            "-fobjc-arc",
            "-bundle",
            "-arch",
            arch,
            f"-mmacosx-version-min={minimum}",
            "-Wno-deprecated-declarations",
            "-Wno-unguarded-availability",
            *[item for framework in frameworks for item in ("-framework", framework)],
            *map(str, sources),
            "-o",
            str(binary),
        ]
        run(command)
        binaries.append(binary)
    if len(binaries) == 1:
        binaries[0].replace(output)
    else:
        run(["lipo", "-create", *map(str, binaries), "-output", str(output)])
        for binary in binaries:
            binary.unlink()


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
    compile_bundle(
        [QL / "generator.m", QL / "preview-provider.m"],
        macos / "WriterClassicPreview",
        ["arm64"],
        ["Foundation", "AppKit", "QuickLook", "QuickLookUI", "UniformTypeIdentifiers", "CoreText", "CoreGraphics", "CoreFoundation"],
        "12.0",
    )
    subprocess.run(["codesign", "-s", "-", "--force", str(APPEX)], check=False)
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
    print("PASS: Quick Look generator loads and previews markdown and text; help book is indexed.")


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
