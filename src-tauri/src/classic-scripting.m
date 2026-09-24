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
        ClassicScriptDocument *document = classic_documents[label];
        if (document.window && ![seen containsObject:label]) [ordered addObject:document];
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

static OSType ClassicCode(NSAppleEventDescriptor *descriptor) {
    if (!descriptor) return 0;
    DescType type = descriptor.descriptorType;
    if (type == typeType || type == typeEnumerated || type == typeProperty || type == typeKeyword || type == typeAbsoluteOrdinal)
        return descriptor.typeCodeValue;
    return descriptor.data.length == 4 ? descriptor.typeCodeValue : 0;
}

static NSString *ClassicCoercedString(NSAppleEventDescriptor *descriptor) {
    if (!descriptor) return nil;
    if (descriptor.stringValue) return descriptor.stringValue;
    return [descriptor coerceToDescriptorType:typeUnicodeText].stringValue;
}

static BOOL ClassicIsApplication(id object) {
    return object == [NSNull null];
}

static NSArray<ClassicScriptDocument *> *ClassicDocuments(void) {
    return [NSApp classicOrderedDocuments] ?: @[];
}

static ClassicScriptDocument *ClassicDocumentAt(NSArray *documents, NSInteger index) {
    if (!documents.count || index == 0) return nil;
    if (index > 0) return index <= (NSInteger)documents.count ? documents[index - 1] : nil;
    NSInteger wrapped = (NSInteger)documents.count + index;
    return wrapped >= 0 && wrapped < (NSInteger)documents.count ? documents[wrapped] : nil;
}

static ClassicScriptDocument *ClassicDocumentNamed(NSArray *documents, NSString *name) {
    if (!name.length) return nil;
    for (ClassicScriptDocument *document in documents) {
        if ([document.name isEqualToString:name] || [document.filePath isEqualToString:name] || [document.label isEqualToString:name])
            return document;
    }
    return nil;
}

static id ClassicPropertyValue(ClassicScriptDocument *document, OSType property) {
    if (!document) return nil;
    switch (property) {
        case 'ctxt': return document.text ?: @"";
        case 'pnam': return document.name ?: @"";
        case 'ppth': return document.filePath ?: @"";
        default: return nil;
    }
}

static id ClassicResolveObject(NSAppleEventDescriptor *specifier, NSAppleEventDescriptor *subject, NSString **error);

static id ClassicResolveObject(NSAppleEventDescriptor *specifier, NSAppleEventDescriptor *subject, NSString **error) {
    if (!specifier || specifier.descriptorType == typeNull) return [NSNull null];
    if (specifier.descriptorType != typeObjectSpecifier && specifier.descriptorType != typeAERecord) {
        if (error) *error = @"unsupported specifier";
        return nil;
    }
    OSType form = ClassicCode([specifier descriptorForKeyword:keyAEKeyForm]);
    OSType want = ClassicCode([specifier descriptorForKeyword:keyAEDesiredClass]);
    NSAppleEventDescriptor *selection = [specifier descriptorForKeyword:keyAEKeyData];
    NSAppleEventDescriptor *from = [specifier descriptorForKeyword:keyAEContainer];
    if ((!from || from.descriptorType == typeNull) && subject.descriptorType == typeObjectSpecifier)
        from = subject;
    id container = ClassicResolveObject(from, nil, error);
    if (!container) return nil;
    if (form == formPropertyID) {
        OSType property = ClassicCode(selection);
        if (ClassicIsApplication(container)) {
            if (property == 'frnt') return [NSApp classicFrontDocument];
            if (error) *error = @"unknown application property";
            return nil;
        }
        if ([container isKindOfClass:[ClassicScriptDocument class]])
            return ClassicPropertyValue(container, property);
        if ([container isKindOfClass:[NSArray class]]) {
            NSMutableArray *values = [NSMutableArray array];
            for (id item in container) {
                if (![item isKindOfClass:[ClassicScriptDocument class]]) continue;
                id value = ClassicPropertyValue(item, property);
                if (value) [values addObject:value];
            }
            return values;
        }
        if (error) *error = @"property has no document";
        return nil;
    }
    if (!ClassicIsApplication(container) && ![container isKindOfClass:[NSArray class]]) {
        if (error) *error = @"elements are not available there";
        return nil;
    }
    if (want && want != 'docu' && want != 'cobj') {
        if (error) *error = @"unsupported class";
        return nil;
    }
    NSArray *documents = [container isKindOfClass:[NSArray class]] ? container : ClassicDocuments();
    if (form == formName || form == formUniqueID) {
        ClassicScriptDocument *document = ClassicDocumentNamed(documents, ClassicCoercedString(selection));
        if (!document && error) *error = @"no such document";
        return document;
    }
    if (form == formAbsolutePosition) {
        OSType ordinal = ClassicCode(selection);
        if (ordinal == kAEAll) return documents;
        if (ordinal == kAEFirst) return documents.firstObject;
        if (ordinal == kAELast) return documents.lastObject;
        if (ordinal == kAEMiddle) return documents.count ? documents[documents.count / 2] : nil;
        if (ordinal == kAEAny) return documents.firstObject;
        ClassicScriptDocument *document = ClassicDocumentAt(documents, selection.int32Value);
        if (!document && error) *error = @"no such document";
        return document;
    }
    if (error) *error = @"unsupported specifier form";
    return nil;
}

static BOOL ClassicResolveAssignment(NSAppleEventDescriptor *event, NSAppleEventDescriptor *specifier, id *object, OSType *property, NSString **error) {
    NSAppleEventDescriptor *subject = [event attributeDescriptorForKeyword:'subj'];
    if (!specifier || specifier.descriptorType == typeNull) {
        *object = [NSApp classicFrontDocument];
        *property = 'ctxt';
        return *object != nil;
    }
    if (ClassicCode([specifier descriptorForKeyword:keyAEKeyForm]) == formPropertyID) {
        *property = ClassicCode([specifier descriptorForKeyword:keyAEKeyData]);
        NSAppleEventDescriptor *from = [specifier descriptorForKeyword:keyAEContainer];
        if (!from || from.descriptorType == typeNull)
            *object = subject.descriptorType == typeObjectSpecifier ? ClassicResolveObject(subject, nil, error) : [NSNull null];
        else *object = ClassicResolveObject(from, nil, error);
        return *object != nil && *property != 0;
    }
    *property = 0;
    *object = ClassicResolveObject(specifier, subject, error);
    return *object != nil;
}

static void ClassicReplyError(NSAppleEventDescriptor *reply, OSStatus code) {
    [reply setParamDescriptor:[NSAppleEventDescriptor descriptorWithInt32:code] forKeyword:keyErrorNumber];
}

static NSAppleEventDescriptor *ClassicReplyValue(id value) {
    if ([value isKindOfClass:[NSString class]])
        return [NSAppleEventDescriptor descriptorWithString:value];
    if ([value isKindOfClass:[ClassicScriptDocument class]])
        return [NSAppleEventDescriptor descriptorWithString:((ClassicScriptDocument *)value).name ?: @""];
    if ([value isKindOfClass:[NSArray class]]) {
        NSAppleEventDescriptor *list = [NSAppleEventDescriptor listDescriptor];
        for (id item in value) {
            NSAppleEventDescriptor *child = ClassicReplyValue(item);
            if (child) [list insertDescriptor:child atIndex:list.numberOfItems + 1];
        }
        return list;
    }
    return nil;
}

static BOOL ClassicAssignText(id object, NSString *value) {
    if ([object isKindOfClass:[ClassicScriptDocument class]]) {
        ((ClassicScriptDocument *)object).text = value;
        return YES;
    }
    if ([object isKindOfClass:[NSArray class]]) {
        for (id item in object)
            if ([item isKindOfClass:[ClassicScriptDocument class]])
                ((ClassicScriptDocument *)item).text = value;
        return YES;
    }
    return NO;
}

@interface ClassicScriptEvents : NSObject
@end

@implementation ClassicScriptEvents
- (void)getData:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply {
    NSAppleEventDescriptor *direct = [event paramDescriptorForKeyword:keyDirectObject];
    if (!direct || direct.descriptorType == typeNull) {
        NSString *text = [[NSApp classicFrontDocument] valueForKey:@"text"] ?: @"";
        [reply setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:text] forKeyword:keyDirectObject];
        return;
    }
    NSString *error = nil;
    id value = ClassicResolveObject(direct, [event attributeDescriptorForKeyword:'subj'], &error);
    NSAppleEventDescriptor *encoded = ClassicReplyValue(value);
    if (!encoded || ClassicIsApplication(value)) {
        ClassicReplyError(reply, errAENoSuchObject);
        return;
    }
    [reply setParamDescriptor:encoded forKeyword:keyDirectObject];
}
- (void)setData:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)reply {
    NSAppleEventDescriptor *direct = [event paramDescriptorForKeyword:keyDirectObject];
    NSString *value = ClassicCoercedString([event paramDescriptorForKeyword:keyAEData]);
    id object = nil;
    OSType property = 0;
    NSString *error = nil;
    if (!direct || direct.descriptorType == typeNull) {
        object = [NSApp classicFrontDocument];
        property = 'ctxt';
    } else if (!ClassicResolveAssignment(event, direct, &object, &property, &error) || !object || ClassicIsApplication(object)) {
        ClassicReplyError(reply, errAENoSuchObject);
        return;
    }
    if (property != 'ctxt' || value == nil || !ClassicAssignText(object, value)) {
        ClassicReplyError(reply, errAENotModifiable);
        return;
    }
    NSAppleEventDescriptor *encoded = ClassicReplyValue([object isKindOfClass:[ClassicScriptDocument class]] ? ((ClassicScriptDocument *)object).text : value);
    if (encoded) [reply setParamDescriptor:encoded forKeyword:keyDirectObject];
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
static NSAppleEventDescriptor *ClassicSpec(OSType want, OSType form, NSAppleEventDescriptor *selection, NSAppleEventDescriptor *container) {
    NSAppleEventDescriptor *record = [NSAppleEventDescriptor recordDescriptor];
    [record setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:want] forKeyword:keyAEDesiredClass];
    [record setDescriptor:[NSAppleEventDescriptor descriptorWithEnumCode:form] forKeyword:keyAEKeyForm];
    [record setDescriptor:selection forKeyword:keyAEKeyData];
    [record setDescriptor:container ?: [NSAppleEventDescriptor nullDescriptor] forKeyword:keyAEContainer];
    return [record coerceToDescriptorType:typeObjectSpecifier] ?: record;
}
static NSAppleEventDescriptor *ClassicDocumentIndex(SInt32 index) {
    return ClassicSpec('docu', formAbsolutePosition, [NSAppleEventDescriptor descriptorWithInt32:index], nil);
}
static NSAppleEventDescriptor *ClassicDocumentName(NSString *name) {
    return ClassicSpec('docu', formName, [NSAppleEventDescriptor descriptorWithString:name], nil);
}
static NSAppleEventDescriptor *ClassicProperty(OSType property, NSAppleEventDescriptor *container) {
    return ClassicSpec('prop', formPropertyID, [NSAppleEventDescriptor descriptorWithTypeCode:property], container);
}
static NSAppleEventDescriptor *ClassicReply(void) {
    return [NSAppleEventDescriptor appleEventWithEventClass:'aevt' eventID:'ansr' targetDescriptor:[NSAppleEventDescriptor nullDescriptor] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
}
static NSAppleEventDescriptor *ClassicGet(ClassicScriptEvents *events, NSAppleEventDescriptor *specifier) {
    NSAppleEventDescriptor *event = [NSAppleEventDescriptor appleEventWithEventClass:'core' eventID:'getd' targetDescriptor:[NSAppleEventDescriptor nullDescriptor] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    if (specifier) [event setParamDescriptor:specifier forKeyword:keyDirectObject];
    NSAppleEventDescriptor *reply = ClassicReply();
    [events getData:specifier ? event : [NSAppleEventDescriptor nullDescriptor] withReplyEvent:reply];
    return reply;
}
static void ClassicSet(ClassicScriptEvents *events, NSAppleEventDescriptor *specifier, NSString *value) {
    NSAppleEventDescriptor *event = [NSAppleEventDescriptor appleEventWithEventClass:'core' eventID:'setd' targetDescriptor:[NSAppleEventDescriptor nullDescriptor] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    if (specifier) [event setParamDescriptor:specifier forKeyword:keyDirectObject];
    [event setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:value] forKeyword:keyAEData];
    [events setData:specifier ? event : event withReplyEvent:ClassicReply()];
}
int main(void) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        classic_install_scripting(harness_open, harness_set);
        NSWindow *emptyWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(20, 20, 200, 120) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        NSWindow *otherWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(40, 40, 200, 120) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        NSWindow *mainWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(60, 60, 200, 120) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        [emptyWindow orderFront:nil];
        [otherWindow orderFront:nil];
        [mainWindow makeKeyAndOrderFront:nil];
        classic_note_document("ghost", "Ghost.md", "", "ghost text", NULL);
        classic_note_document("main", "Notes.md", "/tmp/Notes.md", "alpha beta", (__bridge void *)mainWindow);
        classic_note_document("other", "Other.md", "/tmp/Other.md", "other text", (__bridge void *)otherWindow);
        classic_note_document("empty", "Empty.md", "", "", (__bridge void *)emptyWindow);
        ClassicScriptEvents *events = [ClassicScriptEvents new];
        NSAppleEventDescriptor *frontReply = ClassicReply();
        [events getData:[NSAppleEventDescriptor nullDescriptor] withReplyEvent:frontReply];
        NSString *got = [frontReply paramDescriptorForKeyword:keyDirectObject].stringValue;
        NSAppleEventDescriptor *second = ClassicGet(events, ClassicProperty('ctxt', ClassicDocumentIndex(2)));
        NSAppleEventDescriptor *name = ClassicGet(events, ClassicProperty('pnam', ClassicDocumentIndex(1)));
        NSAppleEventDescriptor *path = ClassicGet(events, ClassicProperty('ppth', ClassicDocumentName(@"Other.md")));
        NSString *emptyText = [ClassicGet(events, ClassicProperty('ctxt', ClassicDocumentName(@"Empty.md"))) paramDescriptorForKeyword:keyDirectObject].stringValue;
        ClassicSet(events, ClassicProperty('ctxt', ClassicDocumentName(@"Other.md")), @"only-other");
        NSString *mainText = [ClassicGet(events, ClassicProperty('ctxt', ClassicDocumentIndex(1))) paramDescriptorForKeyword:keyDirectObject].stringValue;
        NSString *otherText = [ClassicGet(events, ClassicProperty('ctxt', ClassicDocumentIndex(2))) paramDescriptorForKeyword:keyDirectObject].stringValue;
        ClassicSet(events, ClassicProperty('pnam', ClassicDocumentIndex(1)), @"hacked");
        NSString *nameAfter = [ClassicGet(events, ClassicProperty('pnam', ClassicDocumentIndex(1))) paramDescriptorForKeyword:keyDirectObject].stringValue;
        NSString *textAfterName = [ClassicGet(events, ClassicProperty('ctxt', ClassicDocumentIndex(1))) paramDescriptorForKeyword:keyDirectObject].stringValue;
        classic_forget_document("empty");
        NSAppleEventDescriptor *forgotten = ClassicGet(events, ClassicProperty('ctxt', ClassicDocumentName(@"Empty.md")));
        NSAppleEventDescriptor *setEvent = [NSAppleEventDescriptor appleEventWithEventClass:'core' eventID:'setd' targetDescriptor:[NSAppleEventDescriptor nullDescriptor] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
        [setEvent setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:@"gamma δ"] forKeyword:keyAEData];
        NSAppleEventDescriptor *reply = ClassicReply();
        [events setData:setEvent withReplyEvent:reply];
        NSAppleEventDescriptor *openEvent = [NSAppleEventDescriptor appleEventWithEventClass:'aevt' eventID:'odoc' targetDescriptor:[NSAppleEventDescriptor nullDescriptor] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
        [openEvent setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:@"file:///tmp/writer-classic-script-open.md"] forKeyword:keyDirectObject];
        [events openDocument:openEvent withReplyEvent:reply];
        NSString *after = [[app classicFrontDocument] valueForKey:@"text"];
        BOOL targeted = [[second paramDescriptorForKeyword:keyDirectObject].stringValue isEqualToString:@"other text"]
            && [[name paramDescriptorForKeyword:keyDirectObject].stringValue isEqualToString:@"Notes.md"]
            && [[path paramDescriptorForKeyword:keyDirectObject].stringValue isEqualToString:@"/tmp/Other.md"]
            && emptyText != nil && emptyText.length == 0
            && [mainText isEqualToString:@"alpha beta"]
            && [otherText isEqualToString:@"only-other"]
            && [nameAfter isEqualToString:@"Notes.md"]
            && [textAfterName isEqualToString:@"alpha beta"]
            && [forgotten paramDescriptorForKeyword:keyErrorNumber].int32Value == errAENoSuchObject
            && ![app.classicOrderedDocuments containsObject:classic_documents[@"ghost"]];
        BOOL ok = targeted && [got isEqualToString:@"alpha beta"] && [after isEqualToString:@"gamma δ"] && strcmp(set_text, "gamma δ") == 0 && strcmp(opened_path, "/tmp/writer-classic-script-open.md") == 0;
        printf("got=%s\nafter=%s\nset=%s\nopened=%s\nsecond=%s\nname=%s\npath=%s\nempty=%s\nmain=%s\nother=%s\nforgotten=%d\n",
            got.UTF8String ?: "", after.UTF8String ?: "", set_text, opened_path,
            [second paramDescriptorForKeyword:keyDirectObject].stringValue.UTF8String ?: "",
            [name paramDescriptorForKeyword:keyDirectObject].stringValue.UTF8String ?: "",
            [path paramDescriptorForKeyword:keyDirectObject].stringValue.UTF8String ?: "",
            emptyText.UTF8String ?: "(nil)",
            mainText.UTF8String ?: "", otherText.UTF8String ?: "",
            [forgotten paramDescriptorForKeyword:keyErrorNumber].int32Value);
        return ok ? 0 : 1;
    }
}
#endif
