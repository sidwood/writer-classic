#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#import <dlfcn.h>

// AppKit owns this view with the titlebar. Flexible margins keep the group centered
// during resizing; the real document proxy retains its native drag/menu behavior.
static char titleKey;
static char resizeKey;
static char centeringKey;
static void (*classic_menu_action_handler)(void *, const char *) = NULL;

void classic_set_menu_action(void (*handler)(void *, const char *)) {
    classic_menu_action_handler = handler;
}

static void classic_send_menu(NSWindow *window, const char *command) {
    if (classic_menu_action_handler && window) classic_menu_action_handler((__bridge void *)window, command);
}

static void classic_show_version_menu(NSWindow *window) {
    if (!window.representedURL.path.length) return;
    if (![[NSFileManager defaultManager] fileExistsAtPath:window.representedURL.path]) return;
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Versions"];
    for (NSArray *item in @[
        @[@"Browse All Versions…", @"versions"],
        @[@"Last Saved", @"revert"],
        @[@"Previous Save", @"previous-save"],
        @[@"Last Opened", @"last-opened"],
    ]) {
        NSMenuItem *entry = [[NSMenuItem alloc] initWithTitle:item[0] action:@selector(classicTitleMenu:) keyEquivalent:@""];
        entry.representedObject = item[1];
        entry.target = window;
        [menu addItem:entry];
    }
    [menu popUpMenuPositioningItem:nil atLocation:[NSEvent mouseLocation] inView:nil];
}

@interface NSWindow (ClassicTitleMenu)
- (void)classicTitleMenu:(NSMenuItem *)item;
@end
@implementation NSWindow (ClassicTitleMenu)
- (void)classicTitleMenu:(NSMenuItem *)item {
    classic_send_menu(self, [item.representedObject UTF8String]);
}
@end

@interface ClassicTitleGroup : NSView
@end
@implementation ClassicTitleGroup
- (void)mouseUp:(NSEvent *)event {
    [super mouseUp:event];
    classic_show_version_menu(self.window);
}
@end

void classic_center_title(NSWindow *window) {
    if (!window || objc_getAssociatedObject(window, &centeringKey)) return;
    objc_setAssociatedObject(window, &centeringKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    NSView *bar = close.superview;
    if (!bar) {
        objc_setAssociatedObject(window, &centeringKey, nil, OBJC_ASSOCIATION_ASSIGN);
        return;
    }
    NSView *group = objc_getAssociatedObject(window, &titleKey);
    NSTextField *label;
    NSButton *proxy = [window standardWindowButton:NSWindowDocumentIconButton];
    if (!group) {
        group = [[ClassicTitleGroup alloc] initWithFrame:NSZeroRect];
        group.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin;
        label = [NSTextField labelWithString:window.title ?: @""];
        label.tag = 1;
        label.font = [NSFont titleBarFontOfSize:13];
        label.textColor = NSColor.labelColor;
        [group addSubview:label];
        [bar addSubview:group];
        objc_setAssociatedObject(window, &titleKey, group, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        id observer = [[NSNotificationCenter defaultCenter] addObserverForName:NSWindowDidResizeNotification object:window queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *note) {
            classic_center_title(note.object);
        }];
        objc_setAssociatedObject(window, &resizeKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    } else label = [group viewWithTag:1];
    label.stringValue = window.title ?: @"";
    [label sizeToFit];
    CGFloat width = MIN(label.frame.size.width, MAX(40, bar.bounds.size.width - 240));
    CGFloat total = width + 22;
    group.frame = NSMakeRect((bar.bounds.size.width - total) / 2, (bar.bounds.size.height - 20) / 2, total, 20);
    label.frame = NSMakeRect(22, 2, width, 17);
    window.titleVisibility = NSWindowTitleHidden;
    if (proxy) {
        if (proxy.superview != group) {
            [proxy removeFromSuperview];
            [group addSubview:proxy];
        }
        proxy.translatesAutoresizingMaskIntoConstraints = YES;
        proxy.frame = NSMakeRect(0, 1, 18, 18);
        proxy.hidden = NO;
    }
    objc_setAssociatedObject(window, &centeringKey, nil, OBJC_ASSOCIATION_ASSIGN);
}

// Menu tracking clears the key window but keeps the main window.
int classic_is_main_window(NSWindow *window) {
    return window && window.isMainWindow ? 1 : 0;
}

static NSView *classic_find_webview(NSView *view) {
    for (Class kind = view.class; kind; kind = class_getSuperclass(kind))
        if ([NSStringFromClass(kind) isEqualToString:@"WKWebView"]) return view;
    for (NSView *child in view.subviews) {
        NSView *found = classic_find_webview(child);
        if (found) return found;
    }
    return nil;
}

static char keyObserverKey;

static BOOL classic_webview_has_keyboard(NSWindow *window, NSView *webview) {
    NSResponder *responder = window.firstResponder;
    return webview && [responder isKindOfClass:[NSView class]] && [(NSView *)responder isDescendantOf:webview];
}

// wry's content view swallows every key that is not a menu shortcut, so the
// editor receives typing only while its web view is the window's first responder.
static BOOL classic_give_webview_keyboard(NSWindow *window) {
    if (!window.isVisible || !window.contentView) return NO;
    NSView *webview = classic_find_webview(window.contentView);
    if (!webview) return NO;
    if (!classic_webview_has_keyboard(window, webview)) [window makeFirstResponder:webview];
    return classic_webview_has_keyboard(window, webview);
}

static void classic_watch_key(NSWindow *window) {
    if (objc_getAssociatedObject(window, &keyObserverKey)) return;
    id observer = [[NSNotificationCenter defaultCenter] addObserverForName:NSWindowDidBecomeKeyNotification object:window queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *note) {
        NSWindow *key = note.object;
        if (classic_give_webview_keyboard(key)) return;
        dispatch_async(dispatch_get_main_queue(), ^{ classic_give_webview_keyboard(key); });
    }];
    objc_setAssociatedObject(window, &keyObserverKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

// Makes a shown document window key and main and hands its web view the keyboard.
// Returns 1 only when the first responder is the web view or inside it. When the web
// view is not in the hierarchy yet, it tries once more on the next main-queue turn.
int classic_focus_webview(NSWindow *window) {
    if (!window || !window.isVisible) return 0;
    classic_watch_key(window);
    [NSApp activateIgnoringOtherApps:YES];
    [window makeKeyAndOrderFront:nil];
    [window makeMainWindow];
    if (classic_give_webview_keyboard(window)) return 1;
    dispatch_async(dispatch_get_main_queue(), ^{ classic_give_webview_keyboard(window); });
    return 0;
}

// Classic prints a header and footer (IAPrintAccessoryView "Print header and footer",
// NSPrintHeaderAndFooter). AppKit draws the job title and date at the top of each page
// and the page number at the bottom. The web view's print operation starts from the
// shared print info, so the flag is set there before the page asks to print.
void classic_prepare_print(void) {
    NSPrintInfo *info = [NSPrintInfo sharedPrintInfo];
    info.dictionary[NSPrintHeaderAndFooter] = @YES;
}

// Position of a visible window in front-to-back order, or -1 when it is hidden.
long classic_front_order(NSWindow *window) {
    if (!window || !window.isVisible) return -1;
    NSUInteger index = [NSApp.orderedWindows indexOfObject:window];
    return index == NSNotFound ? -1 : (long)index;
}

// A bare executable is named after its file in the Dock and menu bar. Give the
// process the application's display name through LaunchServices. The process name
// itself is left alone: WebKit keys the page's storage directory on it, so renaming
// it would hide existing drafts and preferences.
void classic_set_display_name(const char *name) {
    typedef CFTypeRef (*GetASN)(void);
    typedef OSStatus (*SetItem)(int, CFTypeRef, CFStringRef, CFStringRef, CFDictionaryRef *);
    void *services = dlopen("/System/Library/Frameworks/CoreServices.framework/CoreServices", RTLD_LAZY);
    GetASN getASN = services ? (GetASN)dlsym(services, "_LSGetCurrentApplicationASN") : NULL;
    SetItem setItem = services ? (SetItem)dlsym(services, "_LSSetApplicationInformationItem") : NULL;
    CFStringRef *displayKey = services ? (CFStringRef *)dlsym(services, "_kLSDisplayNameKey") : NULL;
    NSString *value = [NSString stringWithUTF8String:name];
    if (!getASN || !setItem || !displayKey) return;
    CFTypeRef asn = getASN();
    if (asn) setItem(-2, asn, *displayKey, (__bridge CFStringRef)value, NULL);
}

char *classic_open_documents(const char *directory) {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.allowsMultipleSelection = YES;
    panel.canChooseDirectories = NO;
    if (directory && directory[0]) panel.directoryURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:directory]];
    NSView *accessory = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 330, 30)];
    NSTextField *label = [NSTextField labelWithString:@"Encoding:"];
    label.frame = NSMakeRect(0, 5, 80, 22);
    NSPopUpButton *choices = [[NSPopUpButton alloc] initWithFrame:NSMakeRect(80, 0, 250, 30) pullsDown:NO];
    [choices addItemsWithTitles:@[@"Unicode (UTF-8)", @"Unicode (UTF-16)", @"Unicode (UTF-16 Little Endian)", @"Unicode (UTF-16 Big Endian)", @"Western (Windows Latin 1)", @"Western (ISO Latin 1)", @"Western (Mac OS Roman)", @"ASCII"]];
    [accessory addSubview:label];
    [accessory addSubview:choices];
    panel.accessoryView = accessory;
    panel.accessoryViewDisclosed = YES;
    if ([panel runModal] != NSModalResponseOK) return NULL;
    NSUInteger encodings[] = {NSUTF8StringEncoding, NSUnicodeStringEncoding, NSUTF16LittleEndianStringEncoding, NSUTF16BigEndianStringEncoding, NSWindowsCP1252StringEncoding, NSISOLatin1StringEncoding, NSMacOSRomanStringEncoding, NSASCIIStringEncoding};
    NSMutableArray *paths = [NSMutableArray array];
    for (NSURL *url in panel.URLs) [paths addObject:url.path];
    NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"paths": paths, @"encoding": @(encodings[choices.indexOfSelectedItem])} options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    return strdup(text.UTF8String ?: "");
}

@interface ClassicHistoryDocument : NSDocument
@property(strong) NSData *contents;
@property NSUInteger classicEncoding;
- (NSString *)versionText;
- (NSData *)dataFromVersionText;
@end
@implementation ClassicHistoryDocument
+ (BOOL)autosavesInPlace { return YES; }
// Document windows are Tauri web views. AppKit must not open an empty, read-only
// history window as the untitled document at launch or on a Dock reopen.
- (instancetype)initWithType:(NSString *)typeName error:(NSError **)outError {
    (void)typeName;
    if (outError) *outError = [NSError errorWithDomain:NSCocoaErrorDomain code:NSUserCancelledError userInfo:nil];
    return nil;
}
- (NSStringEncoding)versionEncoding {
    return self.classicEncoding ? self.classicEncoding : NSUTF8StringEncoding;
}
- (NSString *)versionText {
    if (!self.contents.length) return @"";
    return [[NSString alloc] initWithData:self.contents encoding:self.versionEncoding] ?: @"";
}
- (NSData *)dataFromVersionText {
    return [self.versionText dataUsingEncoding:self.versionEncoding allowLossyConversion:NO];
}
- (BOOL)readFromData:(NSData *)data ofType:(NSString *)type error:(NSError **)error {
    (void)type; (void)error;
    self.contents = data;
    return YES;
}
- (NSData *)dataOfType:(NSString *)type error:(NSError **)error {
    (void)type; (void)error;
    if (self.contents) return self.contents;
    return [self dataFromVersionText] ?: [NSData data];
}
- (BOOL)writeToURL:(NSURL *)url ofType:(NSString *)typeName error:(NSError **)outError {
    NSData *data = [self dataOfType:typeName error:outError];
    if (!data) return NO;
    return [data writeToURL:url options:NSDataWritingAtomic error:outError];
}
// The web view is the live editor. Do not let NSDocument autosave a stale snapshot over it.
- (void)autosaveWithImplicitCancellability:(BOOL)implicit completionHandler:(void (^)(NSError *))completionHandler {
    (void)implicit;
    if (completionHandler) completionHandler(nil);
}
- (BOOL)revertToContentsOfURL:(NSURL *)url ofType:(NSString *)type error:(NSError **)error {
    (void)type;
    NSData *data = [NSData dataWithContentsOfURL:url options:0 error:error];
    if (!data) return NO;
    self.contents = data;
    if (!self.fileURL) return YES;
    return [data writeToURL:self.fileURL options:NSDataWritingAtomic error:error];
}
- (void)makeWindowControllers {
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 860, 640)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:window.contentView.bounds];
    scroll.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    NSTextView *text = [[NSTextView alloc] initWithFrame:scroll.bounds];
    text.string = [self versionText];
    text.font = [NSFont fontWithName:@"Menlo" size:18];
    text.editable = NO;
    text.textContainerInset = NSMakeSize(55, 45);
    scroll.documentView = text;
    window.contentView = scroll;
    [self addWindowController:[[NSWindowController alloc] initWithWindow:window]];
}
@end

static char documentKey;
const char *classic_browse_versions(NSWindow *window, const char *path, unsigned long encoding, void (*finished)(void *), void *context) {
    @try {
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
        NSError *error = nil;
        ClassicHistoryDocument *document = objc_getAssociatedObject(window, &documentKey);
        if (!document) {
            document = [[ClassicHistoryDocument alloc] initWithContentsOfURL:url ofType:@"Markdown" error:&error];
            if (!document) return strdup(error.localizedDescription.UTF8String ?: "Could not open document versions");
            [document addWindowController:[[NSWindowController alloc] initWithWindow:window]];
            [[NSDocumentController sharedDocumentController] addDocument:document];
            objc_setAssociatedObject(window, &documentKey, document, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        } else {
            if (![document readFromURL:url ofType:@"Markdown" error:&error]) return strdup(error.localizedDescription.UTF8String ?: "Could not refresh document versions");
            document.fileURL = url;
        }
        document.classicEncoding = encoding ? (NSUInteger)encoding : NSUTF8StringEncoding;
        __block id observer;
        observer = [[NSNotificationCenter defaultCenter] addObserverForName:NSWindowDidExitVersionBrowserNotification object:window queue:nil usingBlock:^(NSNotification *note) {
            (void)note;
            [[NSNotificationCenter defaultCenter] removeObserver:observer];
            observer = nil;
            finished(context);
        }];
        [document browseDocumentVersions:nil];
        return NULL;
    } @catch (NSException *exception) {
        return strdup(exception.reason.UTF8String ?: "Could not browse versions");
    }
}

static const char *classic_measure(NSWindow *window, double expectedWidth, BOOL recenter, char *detail, size_t detailLength) {
    if (recenter) classic_center_title(window);
    [window displayIfNeeded];
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    NSButton *proxy = [window standardWindowButton:NSWindowDocumentIconButton];
    NSTextField *label = [objc_getAssociatedObject(window, &titleKey) viewWithTag:1];
    if (!proxy || !label || !close) return "titlebar controls missing";
    NSRect windowFrame = window.frame;
    NSRect icon = [window convertRectToScreen:[proxy convertRect:proxy.bounds toView:nil]];
    NSRect title = [window convertRectToScreen:[label convertRect:label.bounds toView:nil]];
    NSRect lights = [window convertRectToScreen:[close convertRect:close.bounds toView:nil]];
    double gap = NSMinX(title) - NSMaxX(icon);
    double visualCenter = (NSMinX(icon) + NSMaxX(title)) / 2.0;
    double windowCenter = NSMidX(windowFrame);
    double delta = visualCenter - windowCenter;
    snprintf(detail, detailLength, "width=%.1f icon=%.1f..%.1f title=%.1f..%.1f window=%.1f..%.1f delta=%.2f gap=%.1f hidden=%d titleHidden=%d",
        windowFrame.size.width, NSMinX(icon), NSMaxX(icon), NSMinX(title), NSMaxX(title), NSMinX(windowFrame), NSMaxX(windowFrame), delta, gap, proxy.hidden, window.titleVisibility == NSWindowTitleHidden);
    if (fabs(windowFrame.size.width - expectedWidth) > 1) return "unexpected window width";
    if (proxy.hidden) return "document icon hidden";
    if (window.titleVisibility != NSWindowTitleHidden) return "system title still visible";
    if (!window.representedURL.path.length) return "represented URL empty";
    if (NSMaxX(lights) > NSMinX(icon)) return "traffic lights are not left of the icon";
    if (gap < -1 || gap > 12) return "icon is not immediately left of the title";
    if (fabs(delta) > 2) return "title cluster is not centered";
    return NULL;
}

const char *classic_title_geometry_error(const char *iconPath) {
    __block const char *failure = NULL;
    static char report[2048];
    report[0] = 0;
    void (^work)(void) = ^{
        NSApplication *app = [NSApplication sharedApplication];
        (void)app;
        NSData *iconData = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:iconPath]];
        NSImage *icon = [[NSImage alloc] initWithData:iconData];
        if (!icon) { failure = "could not load document icon"; return; }
        icon.size = NSMakeSize(16, 16);
        NSWindowStyleMask masks[] = {
            NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable,
            NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView,
        };
        for (int maskIndex = 0; maskIndex < 2 && !failure; maskIndex++) {
            for (double width = 860; width <= 1280 && !failure; width += 420) {
                NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(-4000, -4000, width, 640) styleMask:masks[maskIndex] backing:NSBackingStoreBuffered defer:NO];
                window.title = @"A document title.md";
                window.representedURL = [NSURL fileURLWithPath:@"/tmp/A document title.md"];
                NSButton *proxy = [window standardWindowButton:NSWindowDocumentIconButton];
                proxy.image = icon;
                [window setFrame:NSMakeRect(-4000, -4000, width, 680) display:YES];
                [window orderBack:nil];
                char detail[512];
                const char *error = classic_measure(window, width, YES, detail, sizeof detail);
                strncat(report, detail, sizeof report - strlen(report) - 1);
                strncat(report, "\n", sizeof report - strlen(report) - 1);
                if (error) failure = error;
                [window orderOut:nil];
            }
        }
        if (failure) return;
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(-4000, -4000, 1280, 640) styleMask:masks[0] backing:NSBackingStoreBuffered defer:NO];
        window.title = @"A very long document title that must stay clear of the traffic lights.md";
        window.representedURL = [NSURL fileURLWithPath:@"/tmp/long-title.md"];
        [window standardWindowButton:NSWindowDocumentIconButton].image = icon;
        [window setFrame:NSMakeRect(-4000, -4000, 1280, 680) display:YES];
        [window orderBack:nil];
        classic_center_title(window);
        [window setFrame:NSMakeRect(-4000, -4000, 560, 680) display:YES];
        char detail[512];
        const char *error = classic_measure(window, 560, NO, detail, sizeof detail);
        strncat(report, "resize ", sizeof report - strlen(report) - 1);
        strncat(report, detail, sizeof report - strlen(report) - 1);
        strncat(report, "\n", sizeof report - strlen(report) - 1);
        if (error) failure = error;
        [window orderOut:nil];
    };
    if ([NSThread isMainThread]) work();
    else dispatch_sync(dispatch_get_main_queue(), work);
    if (failure) {
        char *message = malloc(strlen(failure) + strlen(report) + 2);
        sprintf(message, "%s\n%s", failure, report);
        return message;
    }
    printf("%s", report);
    return NULL;
}

#ifdef CLASSIC_TITLE_GEOMETRY_MAIN
int main(int argc, char **argv) {
    if (argc < 2) return 2;
    const char *error = classic_title_geometry_error(argv[1]);
    if (!error) return 0;
    fprintf(stderr, "%s\n", error);
    return 1;
}
#endif
#ifdef CLASSIC_VERSION_ENCODING_MAIN
int main(void) {
    @autoreleasepool {
        NSData *latin1 = [NSData dataWithBytes:"caf\xe9" length:4];
        ClassicHistoryDocument *document = [ClassicHistoryDocument new];
        document.classicEncoding = NSWindowsCP1252StringEncoding;
        if (![document readFromData:latin1 ofType:@"Markdown" error:nil]) return 1;
        if (![[document versionText] isEqualToString:@"café"]) {
            fprintf(stderr, "latin1 displayed as %s\n", [document versionText].UTF8String ?: "(nil)");
            return 2;
        }
        NSData *written = [document dataOfType:@"Markdown" error:nil];
        if (![written isEqualToData:latin1]) return 3;
        NSData *encoded = [document dataFromVersionText];
        if (![encoded isEqualToData:latin1]) {
            fprintf(stderr, "latin1 rewrite forced another encoding\n");
            return 4;
        }
        NSData *utf16 = [@"ΩA" dataUsingEncoding:NSUTF16BigEndianStringEncoding];
        document.classicEncoding = NSUTF16BigEndianStringEncoding;
        [document readFromData:utf16 ofType:@"Markdown" error:nil];
        if (![[document versionText] isEqualToString:@"ΩA"]) {
            fprintf(stderr, "utf16be displayed as %s\n", [document versionText].UTF8String ?: "(nil)");
            return 5;
        }
        if (![[document dataOfType:@"Markdown" error:nil] isEqualToData:utf16]) return 6;
        if (![[document dataFromVersionText] isEqualToData:utf16]) {
            fprintf(stderr, "utf16be rewrite was not big-endian\n");
            return 7;
        }
        return 0;
    }
}
#endif
