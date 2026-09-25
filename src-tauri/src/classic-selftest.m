#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

// Native self-test for the running app, enabled by WRITER_CLASSIC_NATIVE_SELFTEST=<directory>.
// It posts real NSEvents into the application event queue, so they take the same
// NSApplication -> key window -> first responder path as the keyboard and mouse.
// It triggers View > Dark Mode through the real main menu item, then reads the page
// and snapshots the web view in-process. Nothing here runs unless the variable is set.

static NSString *selftestDirectory;
static NSMutableDictionary *selftestReport;

static WKWebView *selftest_webview(NSView *view) {
    if ([view isKindOfClass:[WKWebView class]]) return (WKWebView *)view;
    for (NSView *child in view.subviews) {
        WKWebView *found = selftest_webview(child);
        if (found) return found;
    }
    return nil;
}

static NSWindow *selftest_document_window(void) {
    for (NSWindow *window in NSApp.orderedWindows)
        if (window.isVisible && window.contentView && selftest_webview(window.contentView)) return window;
    return nil;
}

static void selftest_write(void) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:selftestReport options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
    [json writeToFile:[selftestDirectory stringByAppendingPathComponent:@"native-selftest.json"] atomically:YES];
}

static void selftest_after(double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
}

static NSDictionary *selftest_responder(NSWindow *window) {
    NSResponder *responder = window.firstResponder;
    WKWebView *webview = selftest_webview(window.contentView);
    BOOL inside = [responder isKindOfClass:[NSView class]] && webview && [(NSView *)responder isDescendantOf:webview];
    return @{
        @"firstResponderClass": responder ? NSStringFromClass(responder.class) : @"nil",
        @"firstResponderIsWebView": @(inside),
        @"isKeyWindow": @(window.isKeyWindow),
        @"isMainWindow": @(window.isMainWindow),
        @"windowTitle": window.title ?: @"",
    };
}

static void selftest_snapshot(NSWindow *window, NSString *name, dispatch_block_t done) {
    WKWebView *webview = selftest_webview(window.contentView);
    [webview takeSnapshotWithConfiguration:nil completionHandler:^(NSImage *image, NSError *error) {
        if (image) {
            NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithData:image.TIFFRepresentation];
            NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            [png writeToFile:[selftestDirectory stringByAppendingPathComponent:name] atomically:YES];
        } else selftestReport[[name stringByAppendingString:@"-error"]] = error.localizedDescription ?: @"no image";
        done();
    }];
}

static void selftest_read(NSWindow *window, NSString *key, dispatch_block_t done) {
    WKWebView *webview = selftest_webview(window.contentView);
    NSString *script = @"JSON.stringify({text: document.querySelector('.cm-content')?.innerText ?? null,"
        " active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName,"
        " htmlClass: document.documentElement.className,"
        " bodyBackground: getComputedStyle(document.body).backgroundColor,"
        " mode: document.querySelector('.vim-mode, [aria-label=\"Vim mode\"]')?.textContent ?? null,"
        " error: document.querySelector('.error-message')?.innerText ?? null})";
    [webview evaluateJavaScript:script completionHandler:^(id result, NSError *error) {
        NSMutableDictionary *entry = [selftest_responder(window) mutableCopy];
        if ([result isKindOfClass:[NSString class]]) {
            NSDictionary *page = [NSJSONSerialization JSONObjectWithData:[result dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
            if (page) entry[@"page"] = page;
        }
        if (error) entry[@"scriptError"] = error.localizedDescription;
        selftestReport[key] = entry;
        selftest_write();
        done();
    }];
}

static unsigned short selftest_keycode(unichar c) {
    static NSDictionary *codes;
    if (!codes) codes = @{
        @"a": @0, @"s": @1, @"d": @2, @"f": @3, @"h": @4, @"g": @5, @"z": @6, @"x": @7, @"c": @8, @"v": @9,
        @"b": @11, @"q": @12, @"w": @13, @"e": @14, @"r": @15, @"y": @16, @"t": @17, @"o": @31, @"u": @32,
        @"i": @34, @"p": @35, @"l": @37, @"j": @38, @"k": @40, @"n": @45, @"m": @46, @".": @47, @" ": @49,
    };
    NSNumber *code = codes[[[NSString stringWithCharacters:&c length:1] lowercaseString]];
    return code ? code.unsignedShortValue : 0;
}

static void selftest_post_key(NSWindow *window, NSString *characters, unsigned short keyCode, NSEventModifierFlags flags) {
    NSEventType types[] = {NSEventTypeKeyDown, NSEventTypeKeyUp};
    for (int index = 0; index < 2; index++) {
        NSEventType type = types[index];
        NSEvent *event = [NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:flags timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber context:nil characters:characters charactersIgnoringModifiers:characters isARepeat:NO keyCode:keyCode];
        [NSApp postEvent:event atStart:NO];
    }
}

static void selftest_type(NSWindow *window, NSString *text) {
    for (NSUInteger i = 0; i < text.length; i++) {
        unichar c = [text characterAtIndex:i];
        NSString *s = [NSString stringWithCharacters:&c length:1];
        selftest_post_key(window, s, selftest_keycode(c), [[NSCharacterSet uppercaseLetterCharacterSet] characterIsMember:c] ? NSEventModifierFlagShift : 0);
    }
}

static void selftest_click(NSWindow *window) {
    NSRect content = [window contentRectForFrameRect:window.frame];
    NSPoint point = NSMakePoint(content.size.width / 2, content.size.height * 0.75);
    NSEventType types[] = {NSEventTypeLeftMouseDown, NSEventTypeLeftMouseUp};
    for (int index = 0; index < 2; index++) {
        NSEventType type = types[index];
        NSEvent *event = [NSEvent mouseEventWithType:type location:point modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
        [NSApp postEvent:event atStart:NO];
    }
}

static NSMenuItem *selftest_menu_item(NSString *menuTitle, NSString *itemTitle, NSMenu **owner) {
    for (NSMenuItem *top in NSApp.mainMenu.itemArray) {
        if (![top.submenu.title isEqualToString:menuTitle] && ![top.title isEqualToString:menuTitle]) continue;
        for (NSMenuItem *item in top.submenu.itemArray)
            if ([item.title isEqualToString:itemTitle]) {
                *owner = top.submenu;
                return item;
            }
    }
    return nil;
}

static NSArray *selftest_windows(void) {
    NSMutableArray *windows = [NSMutableArray array];
    for (NSWindow *candidate in NSApp.windows)
        [windows addObject:@{
            @"title": candidate.title ?: @"",
            @"visible": @(candidate.isVisible),
            @"webview": @(candidate.contentView && selftest_webview(candidate.contentView) != nil),
            @"contentViewClass": candidate.contentView ? NSStringFromClass(candidate.contentView.class) : @"nil",
        }];
    return windows;
}

static void selftest_finish(void) {
    selftestReport[@"windowsAtEnd"] = selftest_windows();
    selftestReport[@"finished"] = @YES;
    selftest_write();
}

void classic_prepare_print(void);

@interface ClassicSelftestPrint : NSObject
@property(copy) dispatch_block_t done;
@end
@implementation ClassicSelftestPrint
- (void)printOperationDidRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)context {
    (void)operation; (void)context;
    selftestReport[@"printSucceeded"] = @(success);
    self.done();
}
@end
static ClassicSelftestPrint *selftestPrinter;

// Prints the page to a PDF with the same shared print info File > Print uses, after
// the app's print preparation, without showing the print panel.
static void selftest_print(NSWindow *window, dispatch_block_t done) {
    WKWebView *webview = selftest_webview(window.contentView);
    classic_prepare_print();
    NSPrintInfo *info = [[NSPrintInfo sharedPrintInfo] copy];
    info.jobDisposition = NSPrintSaveJob;
    info.dictionary[NSPrintJobSavingURL] = [NSURL fileURLWithPath:[selftestDirectory stringByAppendingPathComponent:@"native-print.pdf"]];
    selftestReport[@"printHeaderAndFooter"] = info.dictionary[NSPrintHeaderAndFooter] ?: @NO;
    NSPrintOperation *operation = [webview printOperationWithPrintInfo:info];
    operation.showsPrintPanel = NO;
    operation.showsProgressPanel = NO;
    operation.view.frame = webview.bounds;
    selftestPrinter = [ClassicSelftestPrint new];
    selftestPrinter.done = done;
    [operation runOperationModalForWindow:window delegate:selftestPrinter didRunSelector:@selector(printOperationDidRun:success:contextInfo:) contextInfo:NULL];
}

static NSWindow *selftestOther;

// Another window takes key and main, as the empty AppKit document window did in
// the window Sid rejected. The document window stays visible behind it.
static void selftest_other_window_toggle(NSWindow *window, NSMenu *view, NSMenuItem *dark) {
    selftestOther = [[NSWindow alloc] initWithContentRect:NSMakeRect(80, 80, 240, 120) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    selftestOther.releasedWhenClosed = NO;
    selftestOther.title = @"Selftest other window";
    [selftestOther makeKeyAndOrderFront:nil];
    [selftestOther makeMainWindow];
    selftest_after(0.5, ^{
        selftestReport[@"otherKeyWindow"] = NSApp.keyWindow.title ?: @"nil";
        selftestReport[@"otherMainWindow"] = NSApp.mainWindow.title ?: @"nil";
        selftestReport[@"documentKeyOrMain"] = @(window.isKeyWindow || window.isMainWindow);
        [view performActionForItemAtIndex:[view indexOfItem:dark]];
        selftest_after(1.5, ^{
            selftestReport[@"darkMenuAfterOtherWindowToggle"] = @(dark.state == NSControlStateValueOn);
            selftest_read(window, @"afterOtherWindowToggle", ^{
                [selftestOther close];
                selftest_print(window, ^{ selftest_finish(); });
            });
        });
    });
}

static void selftest_dark(NSWindow *window) {
    NSMenu *view = nil;
    NSMenuItem *dark = selftest_menu_item(@"View", @"Dark Mode", &view);
    if (!dark) {
        selftestReport[@"darkMenu"] = @"View > Dark Mode not found";
        return selftest_finish();
    }
    selftestReport[@"darkMenuBefore"] = @(dark.state == NSControlStateValueOn);
    [view performActionForItemAtIndex:[view indexOfItem:dark]];
    selftest_after(1.5, ^{
        selftestReport[@"darkMenuAfter"] = @(dark.state == NSControlStateValueOn);
        selftest_read(window, @"afterDarkMode", ^{
            selftest_snapshot(window, @"native-dark-mode.png", ^{
                selftest_other_window_toggle(window, view, dark);
            });
        });
    });
}

static void selftest_run(NSWindow *window) {
    selftest_read(window, @"afterShow", ^{
        selftest_click(window);
        selftest_after(0.6, ^{
            selftest_read(window, @"afterClick", ^{
                selftest_post_key(window, @"\e", 53, 0);
                selftest_type(window, @"i");
                selftest_after(0.3, ^{
                    selftest_type(window, @"Typed in the native window.");
                    selftest_post_key(window, @"\e", 53, 0);
                    selftest_after(1.0, ^{
                        selftest_read(window, @"afterTyping", ^{
                            selftest_snapshot(window, @"native-typing.png", ^{ selftest_dark(window); });
                        });
                    });
                });
            });
        });
    });
}

// Golden mode, WRITER_CLASSIC_GOLDEN_WIDTH=<points>: size the document window to the
// installed Classic window, show WRITER_CLASSIC_GOLDEN_TEXT in light mode with the
// caret parked after the text, and snapshot the web view to golden-clone.png.
// scripts/classic-golden.sh compares that snapshot with a capture of Classic.
static void selftest_golden(NSWindow *window, double width, double height, NSString *text) {
    NSRect frame = window.frame;
    frame.origin.y += frame.size.height - height;
    frame.size = NSMakeSize(width, height);
    [window setFrame:frame display:YES];
    NSMenu *view = nil;
    NSMenuItem *dark = selftest_menu_item(@"View", @"Dark Mode", &view);
    if (dark && dark.state == NSControlStateValueOn) [view performActionForItemAtIndex:[view indexOfItem:dark]];
    selftest_after(1.5, ^{
        NSData *json = [NSJSONSerialization dataWithJSONObject:@[text] options:0 error:nil];
        NSString *literal = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
        NSString *script = [NSString stringWithFormat:@"(() => {"
            " const content = document.querySelector('.cm-content');"
            " const view = (content.cmView ?? content.cmTile).view;"
            " const text = %@[0];"
            " view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: text}, selection: {anchor: text.length}});"
            " content.blur();"
            " const scroller = document.querySelector('.cm-scroller').getBoundingClientRect();"
            " const line = content.querySelector('.cm-line').getBoundingClientRect();"
            " return JSON.stringify({innerWidth: window.innerWidth, htmlClass: document.documentElement.className,"
            " fontSize: getComputedStyle(content).fontSize, lineHeight: getComputedStyle(content).lineHeight,"
            " fontFamily: getComputedStyle(content).fontFamily,"
            " textLeft: line.left, textTop: line.top - scroller.top, scrollerTop: scroller.top});"
            "})()", literal];
        WKWebView *webview = selftest_webview(window.contentView);
        [webview evaluateJavaScript:script completionHandler:^(id result, NSError *error) {
            NSMutableDictionary *golden = [NSMutableDictionary dictionary];
            golden[@"windowWidth"] = @(window.frame.size.width);
            golden[@"windowHeight"] = @(window.frame.size.height);
            golden[@"titlebarHeight"] = @(window.frame.size.height - window.contentLayoutRect.size.height);
            golden[@"webviewWidth"] = @(webview.bounds.size.width);
            golden[@"backingScale"] = @(window.backingScaleFactor);
            if ([result isKindOfClass:[NSString class]])
                golden[@"page"] = [NSJSONSerialization JSONObjectWithData:[result dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] ?: result;
            if (error) golden[@"scriptError"] = error.userInfo[@"WKJavaScriptExceptionMessage"] ?: error.localizedDescription;
            selftestReport[@"golden"] = golden;
            selftest_after(0.8, ^{
                selftest_snapshot(window, @"golden-clone.png", ^{ selftest_finish(); });
            });
        }];
    });
}

static void selftest_wait(int attempt) {
    NSWindow *window = selftest_document_window();
    if (window && attempt >= 0) {
        NSDictionary *environment = NSProcessInfo.processInfo.environment;
        NSString *goldenWidth = environment[@"WRITER_CLASSIC_GOLDEN_WIDTH"];
        if (goldenWidth.doubleValue > 0) {
            double height = [environment[@"WRITER_CLASSIC_GOLDEN_HEIGHT"] doubleValue];
            NSString *path = environment[@"WRITER_CLASSIC_GOLDEN_TEXT"];
            NSString *text = path ? [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] : nil;
            return selftest_after(3.0, ^{
                selftest_golden(window, goldenWidth.doubleValue, height > 0 ? height : 615, text ?: @"");
            });
        }
        // Give the page time to finish its startup work before driving it.
        return selftest_after(3.0, ^{ selftest_run(window); });
    }
    if (attempt > 40) {
        selftestReport[@"error"] = @"no visible document window";
        NSMutableArray *windows = [NSMutableArray array];
        NSWindow *hidden = nil;
        for (NSWindow *candidate in NSApp.windows) {
            BOOL hasWebView = candidate.contentView && selftest_webview(candidate.contentView);
            [windows addObject:@{@"title": candidate.title ?: @"", @"visible": @(candidate.isVisible), @"webview": @(hasWebView)}];
            if (hasWebView && !hidden) hidden = candidate;
        }
        selftestReport[@"windows"] = windows;
        if (hidden) return selftest_read(hidden, @"hiddenWindow", ^{ selftest_finish(); });
        return selftest_finish();
    }
    selftest_after(0.5, ^{ selftest_wait(attempt + 1); });
}

void classic_native_selftest(const char *directory) {
    selftestDirectory = [NSString stringWithUTF8String:directory];
    [[NSFileManager defaultManager] createDirectoryAtPath:selftestDirectory withIntermediateDirectories:YES attributes:nil error:nil];
    selftestReport = [NSMutableDictionary dictionary];
    selftestReport[@"pid"] = @(NSProcessInfo.processInfo.processIdentifier);
    selftestReport[@"processName"] = NSProcessInfo.processInfo.processName;
    selftest_after(1.0, ^{ selftest_wait(0); });
}
