#import <Cocoa/Cocoa.h>
#import <string.h>
#import <stdlib.h>

typedef void (*ClassicOpenHandler)(const char *);
typedef void (*ClassicSetTextHandler)(const char *, const char *);

static ClassicOpenHandler classic_open_handler;
static ClassicSetTextHandler classic_set_text_handler;
static NSMutableDictionary *classic_documents;
static NSMutableArray<NSString *> *classic_order;

@interface ClassicScriptDocument : NSObject
@property(copy) NSString *label;
@property(copy) NSString *name;
@property(nonatomic, copy) NSString *text;
@property(copy) NSString *filePath;
@property(weak) NSWindow *window;
- (void)replaceTextFromEditor:(NSString *)text;
@end

@implementation ClassicScriptDocument
- (void)setText:(NSString *)text {
    _text = [text copy] ?: @"";
    if (classic_set_text_handler && self.label)
        classic_set_text_handler(self.label.UTF8String, _text.UTF8String);
}
- (void)replaceTextFromEditor:(NSString *)text {
    _text = [text copy] ?: @"";
}
@end

static void classic_ensure(void) {
    if (!classic_documents) {
        classic_documents = [NSMutableDictionary dictionary];
        classic_order = [NSMutableArray array];
    }
}

@interface NSApplication (ClassicScripting)
- (NSArray *)classicOrderedDocuments;
- (id)classicFrontDocument;
@end

@implementation NSApplication (ClassicScripting)
- (NSArray *)classicOrderedDocuments {
    classic_ensure();
    NSMutableArray *ordered = [NSMutableArray array];
    NSMutableSet *seen = [NSMutableSet set];
    for (NSWindow *window in self.orderedWindows) {
        for (ClassicScriptDocument *document in classic_documents.allValues) {
            if (document.window == window && ![seen containsObject:document.label]) {
                [ordered addObject:document];
                [seen addObject:document.label];
            }
        }
    }
    for (NSString *label in classic_order) {
        if (![seen containsObject:label] && classic_documents[label]) [ordered addObject:classic_documents[label]];
    }
    return ordered;
}
- (id)classicFrontDocument {
    classic_ensure();
    for (ClassicScriptDocument *document in classic_documents.allValues) {
        if (document.window && document.window == self.keyWindow) return document;
    }
    return self.classicOrderedDocuments.firstObject;
}
@end

@interface ClassicOpenCommand : NSScriptCommand
@end

@implementation ClassicOpenCommand
- (id)performDefaultImplementation {
    id parameter = self.directParameter;
    NSArray *items = [parameter isKindOfClass:[NSArray class]] ? parameter : (parameter ? @[parameter] : @[]);
    for (id item in items) {
        NSString *path = nil;
        if ([item isKindOfClass:[NSURL class]]) path = [(NSURL *)item path];
        else if ([item isKindOfClass:[NSString class]]) path = item;
        else if ([item respondsToSelector:@selector(path)]) path = [item path];
        if (path.length && classic_open_handler) classic_open_handler(path.UTF8String);
    }
    return [NSApp classicFrontDocument];
}
@end

@interface ClassicScriptEvents : NSObject
@end

@implementation ClassicScriptEvents
- (void)getData:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply {
    (void)event;
    NSString *text = [[NSApp classicFrontDocument] valueForKey:@"text"] ?: @"";
    [reply setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:text] forKeyword:keyDirectObject];
}
- (void)setData:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply {
    NSString *text = [event paramDescriptorForKeyword:keyAEData].stringValue;
    ClassicScriptDocument *document = [NSApp classicFrontDocument];
    if (document && text) document.text = text;
    [reply setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:document.text ?: @""] forKeyword:keyDirectObject];
}
- (void)openDocument:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply {
    (void)reply;
    NSAppleEventDescriptor *direct = [event paramDescriptorForKeyword:keyDirectObject];
    NSMutableArray *items = [NSMutableArray array];
    if (direct.numberOfItems > 0) {
        for (NSInteger index = 1; index <= direct.numberOfItems; index++) [items addObject:[direct descriptorAtIndex:index]];
    } else if (direct) [items addObject:direct];
    for (NSAppleEventDescriptor *item in items) {
        NSAppleEventDescriptor *file = [item coerceToDescriptorType:typeFileURL] ?: item;
        NSString *value = file.stringValue ?: item.stringValue;
        NSString *path = [value hasPrefix:@"file://"] ? [NSURL URLWithString:value].path : value;
        if (path.length && classic_open_handler) classic_open_handler(path.UTF8String);
    }
}
@end

static ClassicScriptEvents *classic_events;

static void classic_install_events(void) {
    if (!classic_events) classic_events = [ClassicScriptEvents new];
    NSAppleEventManager *manager = [NSAppleEventManager sharedAppleEventManager];
    [manager setEventHandler:classic_events andSelector:@selector(getData:withReplyEvent:) forEventClass:'core' andEventID:'getd'];
    [manager setEventHandler:classic_events andSelector:@selector(setData:withReplyEvent:) forEventClass:'core' andEventID:'setd'];
    [manager setEventHandler:classic_events andSelector:@selector(openDocument:withReplyEvent:) forEventClass:'aevt' andEventID:'odoc'];
}

void classic_install_scripting(ClassicOpenHandler open_handler, ClassicSetTextHandler set_handler) {
    classic_open_handler = open_handler;
    classic_set_text_handler = set_handler;
    classic_ensure();
    classic_install_events();
}

void classic_note_document(const char *label, const char *title, const char *path, const char *text, void *window) {
    if (!label) return;
    classic_ensure();
    NSString *key = [NSString stringWithUTF8String:label];
    ClassicScriptDocument *document = classic_documents[key];
    if (!document) {
        document = [ClassicScriptDocument new];
        document.label = key;
        classic_documents[key] = document;
        [classic_order addObject:key];
    }
    document.name = title ? [NSString stringWithUTF8String:title] : @"Untitled";
    document.filePath = path && path[0] ? [NSString stringWithUTF8String:path] : @"";
    [document replaceTextFromEditor:text ? [NSString stringWithUTF8String:text] : @""];
    document.window = (__bridge NSWindow *)window;
}

void classic_forget_document(const char *label) {
    if (!label) return;
    classic_ensure();
    NSString *key = [NSString stringWithUTF8String:label];
    [classic_documents removeObjectForKey:key];
    [classic_order removeObject:key];
}

const char *classic_help_page_in_book(const char *book_path) {
    if (!book_path) return strdup("Help book is missing");
    NSString *page = [[NSString stringWithUTF8String:book_path] stringByAppendingPathComponent:@"Contents/Resources/en.lproj/index.html"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:page]) return strdup("Help page is missing");
    NSString *html = [NSString stringWithContentsOfFile:page encoding:NSUTF8StringEncoding error:nil];
    if (![html containsString:@"Writer Classic Help"] || ![html containsString:@"id=\"top\""]) return strdup("Help page is not the Writer Classic book");
    return strdup(page.UTF8String);
}

const char *classic_open_help(void) {
    @autoreleasepool {
        NSString *book = [[NSBundle mainBundle] pathForResource:@"WriterClassicHelp" ofType:nil];
        if (!book) return strdup("Help book is not installed");
        const char *page = classic_help_page_in_book(book.UTF8String);
        if (!page || strncmp(page, "Help ", 5) == 0) return page;
        if (getenv("WRITER_CLASSIC_HELP_DRY_RUN")) {
            printf("%s\n", page);
            free((void *)page);
            return NULL;
        }
        [[NSHelpManager sharedHelpManager] registerBooksInBundle:[NSBundle mainBundle]];
        [[NSHelpManager sharedHelpManager] openHelpAnchor:@"top" inBook:@"com.sidwood.writer-classic.help"];
        NSURL *pageURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:page]];
        BOOL opened = [[NSWorkspace sharedWorkspace] openURL:pageURL];
        free((void *)page);
        return opened ? NULL : strdup("Could not open Writer Classic Help");
    }
}

char *classic_detect_data(const char *utf8, int links, int data) {
    @autoreleasepool {
        NSString *text = utf8 ? [NSString stringWithUTF8String:utf8] : @"";
        NSTextCheckingTypes types = 0;
        if (links) types |= NSTextCheckingTypeLink;
        if (data) types |= NSTextCheckingTypeDate | NSTextCheckingTypeAddress | NSTextCheckingTypePhoneNumber | NSTextCheckingTypeTransitInformation;
        if (!types || !text.length) return strdup("[]");
        NSDataDetector *detector = [NSDataDetector dataDetectorWithTypes:types error:nil];
        if (!detector) return strdup("[]");
        NSMutableArray *found = [NSMutableArray array];
        [detector enumerateMatchesInString:text options:0 range:NSMakeRange(0, text.length) usingBlock:^(NSTextCheckingResult *result, NSMatchingFlags flags, BOOL *stop) {
            (void)flags; (void)stop;
            NSString *kind = @"text";
            NSString *value = [text substringWithRange:result.range];
            if (result.resultType == NSTextCheckingTypeLink) {
                kind = @"link";
                value = result.URL.absoluteString ?: value;
            } else if (result.resultType == NSTextCheckingTypePhoneNumber) {
                kind = @"phone";
                value = result.phoneNumber ?: value;
            } else if (result.resultType == NSTextCheckingTypeAddress) {
                kind = @"address";
            } else if (result.resultType == NSTextCheckingTypeDate) {
                kind = @"date";
            } else if (result.resultType == NSTextCheckingTypeTransitInformation) kind = @"transit";
            [found addObject:@{@"start": @(result.range.location), @"end": @(NSMaxRange(result.range)), @"kind": kind, @"value": value ?: @""}];
        }];
        NSData *json = [NSJSONSerialization dataWithJSONObject:found options:0 error:nil];
        return strdup([[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] UTF8String] ?: "[]");
    }
}

const char *classic_arrange_in_front_error(void) {
    __block const char *failure = NULL;
    void (^work)(void) = ^{
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSWindow *back = [[NSWindow alloc] initWithContentRect:NSMakeRect(30, 30, 220, 120) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        NSWindow *front = [[NSWindow alloc] initWithContentRect:NSMakeRect(70, 70, 220, 120) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        back.title = @"Back document";
        front.title = @"Front document";
        [back orderFront:nil];
        [front orderFront:nil];
        if ([app.orderedWindows indexOfObject:front] > [app.orderedWindows indexOfObject:back]) {
            failure = "could not order the front window first";
            return;
        }
        [app arrangeInFront:nil];
        if (!back.isVisible || !front.isVisible) {
            failure = "Bring All to Front hid a window";
            return;
        }
        NSUInteger frontIndex = [app.orderedWindows indexOfObject:front];
        NSUInteger backIndex = [app.orderedWindows indexOfObject:back];
        if (frontIndex == NSNotFound || backIndex == NSNotFound || frontIndex > backIndex)
            failure = "Bring All to Front did not keep every window in front in the same order";
        [front orderOut:nil];
        [back orderOut:nil];
    };
    if ([NSThread isMainThread]) work();
    else dispatch_sync(dispatch_get_main_queue(), work);
    return failure;
}

#ifdef CLASSIC_ARRANGE_MAIN
int main(void) {
    const char *error = classic_arrange_in_front_error();
    if (!error) return 0;
    fprintf(stderr, "%s\n", error);
    return 1;
}
#endif

#ifdef CLASSIC_SCRIPT_HARNESS
static char opened_path[4096];
static char set_text[4096];
static void harness_open(const char *path) { strlcpy(opened_path, path, sizeof opened_path); }
static void harness_set(const char *label, const char *text) {
    (void)label;
    strlcpy(set_text, text, sizeof set_text);
}
int main(void) {
    @autoreleasepool {
        [[NSUserDefaults standardUserDefaults] registerDefaults:@{@"ApplePersistenceIgnoreState": @YES}];
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        classic_install_scripting(harness_open, harness_set);
        classic_note_document("main", "Notes.md", "/tmp/Notes.md", "alpha beta", NULL);
        NSString *done = @"/tmp/writer-script-done";
        [[NSFileManager defaultManager] removeItemAtPath:done error:nil];
        [@"ready" writeToFile:@"/tmp/writer-script-ready" atomically:YES encoding:NSUTF8StringEncoding error:nil];
        [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) {
            (void)timer;
            classic_install_events();
            if (![[NSFileManager defaultManager] fileExistsAtPath:done]) return;
            NSString *after = [[NSApp classicFrontDocument] valueForKey:@"text"];
            NSString *result = [NSString stringWithFormat:@"after=%@\nset=%s\nopened=%s\n", after ?: @"", set_text, opened_path];
            [result writeToFile:@"/tmp/writer-script-result" atomically:YES encoding:NSUTF8StringEncoding error:nil];
            printf("%s", result.UTF8String);
            BOOL ok = [after isEqualToString:@"gamma δ"] && strcmp(set_text, "gamma δ") == 0 && strcmp(opened_path, "/tmp/writer-classic-script-open.md") == 0;
            exit(ok ? 0 : 1);
        }];
        [app run];
        return 1;
    }
}
#endif
#ifdef CLASSIC_SCRIPT_SELFTEST
static char opened_path[4096];
static char set_text[4096];
static void harness_open(const char *path) { strlcpy(opened_path, path, sizeof opened_path); }
static void harness_set(const char *label, const char *text) {
    (void)label;
    strlcpy(set_text, text, sizeof set_text);
}
int main(void) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        classic_install_scripting(harness_open, harness_set);
        classic_note_document("main", "Notes.md", "/tmp/Notes.md", "alpha beta", NULL);
        ClassicScriptEvents *events = [ClassicScriptEvents new];
        NSAppleEventDescriptor *reply = [NSAppleEventDescriptor appleEventWithEventClass:'aevt' eventID:'ansr' targetDescriptor:[NSAppleEventDescriptor nullDescriptor] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
        [events getData:[NSAppleEventDescriptor nullDescriptor] withReplyEvent:reply];
        NSString *got = [reply paramDescriptorForKeyword:keyDirectObject].stringValue;
        NSAppleEventDescriptor *setEvent = [NSAppleEventDescriptor appleEventWithEventClass:'core' eventID:'setd' targetDescriptor:[NSAppleEventDescriptor nullDescriptor] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
        [setEvent setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:@"gamma δ"] forKeyword:keyAEData];
        [events setData:setEvent withReplyEvent:reply];
        NSAppleEventDescriptor *openEvent = [NSAppleEventDescriptor appleEventWithEventClass:'aevt' eventID:'odoc' targetDescriptor:[NSAppleEventDescriptor nullDescriptor] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
        [openEvent setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:@"file:///tmp/writer-classic-script-open.md"] forKeyword:keyDirectObject];
        [events openDocument:openEvent withReplyEvent:reply];
        NSString *after = [[app classicFrontDocument] valueForKey:@"text"];
        BOOL ok = [got isEqualToString:@"alpha beta"] && [after isEqualToString:@"gamma δ"] && strcmp(set_text, "gamma δ") == 0 && strcmp(opened_path, "/tmp/writer-classic-script-open.md") == 0;
        printf("got=%s\nafter=%s\nset=%s\nopened=%s\n", got.UTF8String ?: "", after.UTF8String ?: "", set_text, opened_path);
        return ok ? 0 : 1;
    }
}
#endif
