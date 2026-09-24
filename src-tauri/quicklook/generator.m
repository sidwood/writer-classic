#import <CoreFoundation/CoreFoundation.h>
#import <CoreFoundation/CFPlugInCOM.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>
#import <QuickLook/QuickLook.h>

static NSString *EscapeHTML(NSString *text) {
    NSMutableString *out = [NSMutableString stringWithString:text ?: @""];
    [out replaceOccurrencesOfString:@"&" withString:@"&amp;" options:0 range:NSMakeRange(0, out.length)];
    [out replaceOccurrencesOfString:@"<" withString:@"&lt;" options:0 range:NSMakeRange(0, out.length)];
    [out replaceOccurrencesOfString:@">" withString:@"&gt;" options:0 range:NSMakeRange(0, out.length)];
    return out;
}

static NSString *InlineMarkdown(NSString *escaped) {
    NSMutableString *text = [NSMutableString string];
    NSMutableArray<NSString *> *codes = [NSMutableArray array];
    NSUInteger index = 0, length = escaped.length;
    while (index < length) {
        if ([escaped characterAtIndex:index] != '`') {
            [text appendFormat:@"%C", [escaped characterAtIndex:index]];
            index++;
            continue;
        }
        NSUInteger open = index;
        while (index < length && [escaped characterAtIndex:index] == '`') index++;
        NSUInteger ticks = index - open;
        NSUInteger scan = index, close = NSNotFound;
        while (scan < length) {
            if ([escaped characterAtIndex:scan] != '`') { scan++; continue; }
            NSUInteger run = scan;
            while (run < length && [escaped characterAtIndex:run] == '`') run++;
            if (run - scan == ticks) { close = scan; break; }
            scan = run;
        }
        if (close == NSNotFound) {
            for (NSUInteger tick = 0; tick < ticks; tick++) [text appendString:@"`"];
            continue;
        }
        NSString *content = [escaped substringWithRange:NSMakeRange(index, close - index)];
        if (content.length >= 2 && [content hasPrefix:@" "] && [content hasSuffix:@" "] && [content stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]].length)
            content = [content substringWithRange:NSMakeRange(1, content.length - 2)];
        [codes addObject:content ?: @""];
        [text appendFormat:@"\uE000%lu\uE001", (unsigned long)codes.count - 1];
        index = close + ticks;
    }
    NSRegularExpression *strong = [NSRegularExpression regularExpressionWithPattern:@"\\*\\*([^*]+)\\*\\*" options:0 error:nil];
    NSRegularExpression *emphasis = [NSRegularExpression regularExpressionWithPattern:@"(?<!\\*)\\*([^*]+)\\*(?!\\*)" options:0 error:nil];
    NSRegularExpression *link = [NSRegularExpression regularExpressionWithPattern:@"\\[([^\\]]+)\\]\\((https?://[^\\s)]+)\\)" options:0 error:nil];
    [strong replaceMatchesInString:text options:0 range:NSMakeRange(0, text.length) withTemplate:@"<strong>$1</strong>"];
    [emphasis replaceMatchesInString:text options:0 range:NSMakeRange(0, text.length) withTemplate:@"<em>$1</em>"];
    [link replaceMatchesInString:text options:0 range:NSMakeRange(0, text.length) withTemplate:@"<a href=\"$2\">$1</a>"];
    for (NSUInteger code = 0; code < codes.count; code++) {
        NSString *token = [NSString stringWithFormat:@"\uE000%lu\uE001", (unsigned long)code];
        [text replaceOccurrencesOfString:token withString:[NSString stringWithFormat:@"<code>%@</code>", codes[code]] options:0 range:NSMakeRange(0, text.length)];
    }
    return text;
}

static BOOL FenceLine(NSString *line, unichar *delimiter, NSUInteger *length, NSString **info, BOOL *closer) {
    NSUInteger index = 0;
    while (index < line.length && index < 3 && [line characterAtIndex:index] == ' ') index++;
    if (index >= line.length) return NO;
    unichar marker = [line characterAtIndex:index];
    if (marker != '`' && marker != '~') return NO;
    NSUInteger start = index;
    while (index < line.length && [line characterAtIndex:index] == marker) index++;
    if (index - start < 3) return NO;
    NSString *rest = [line substringFromIndex:index];
    if (marker == '`' && [rest containsString:@"`"]) return NO;
    *delimiter = marker;
    *length = index - start;
    *info = [rest stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    *closer = (*info).length == 0;
    return YES;
}

static BOOL ListLine(NSString *line, NSInteger *depth, unichar *kind, NSString **content) {
    NSUInteger index = 0;
    while (index < line.length && index < 3 && [line characterAtIndex:index] == ' ') index++;
    if (index >= line.length) return NO;
    unichar marker = [line characterAtIndex:index];
    if (marker == '*' || marker == '-' || marker == '+') {
        NSUInteger start = index;
        if (marker == '*') while (index < line.length && [line characterAtIndex:index] == '*') index++;
        else index++;
        if (index >= line.length || [line characterAtIndex:index] != ' ') return NO;
        *depth = marker == '*' ? (NSInteger)(index - start) : 1;
        *kind = 'u';
        *content = [line substringFromIndex:index + 1];
        return *depth > 0;
    }
    NSInteger levels = 0;
    BOOL digits = NO;
    while (index < line.length) {
        unichar character = [line characterAtIndex:index];
        if (character >= '0' && character <= '9') { digits = YES; index++; continue; }
        if (character == '.' && digits) {
            levels++;
            digits = NO;
            index++;
            if (index < line.length && [line characterAtIndex:index] == ' ') {
                *depth = levels;
                *kind = 'o';
                *content = [line substringFromIndex:index + 1];
                return YES;
            }
            continue;
        }
        break;
    }
    return NO;
}

static void CloseLists(NSMutableString *body, NSInteger *depth, unichar kind) {
    while (*depth > 0) {
        [body appendString:@"</li>"];
        [body appendString:kind == 'o' ? @"</ol>" : @"</ul>"];
        (*depth)--;
    }
}

static void AppendListItem(NSMutableString *body, NSInteger *openDepth, unichar *openKind, NSInteger depth, unichar kind, NSString *html) {
    if (*openDepth && *openKind != kind) CloseLists(body, openDepth, *openKind);
    if (depth < 1) depth = 1;
    if (*openDepth == depth) [body appendString:@"</li><li>"];
    else if (*openDepth > depth) {
        while (*openDepth > depth) {
            [body appendString:@"</li>"];
            [body appendString:*openKind == 'o' ? @"</ol>" : @"</ul>"];
            (*openDepth)--;
        }
        [body appendString:@"</li><li>"];
    } else {
        while (*openDepth < depth) {
            [body appendString:kind == 'o' ? @"<ol>" : @"<ul>"];
            [body appendString:@"<li>"];
            (*openDepth)++;
            *openKind = kind;
        }
    }
    [body appendString:html ?: @""];
}

static BOOL IsMarkdown(NSString *uti, NSString *name) {
    NSString *lower = name.lowercaseString ?: @"";
    if ([uti containsString:@"markdown"]) return YES;
    for (NSString *ext in @[@"md", @"markdown", @"mmd", @"mdown", @"mkdn", @"mkd", @"mdwn", @"mdtxt", @"mdtext", @"mdml"]) {
        if ([lower hasSuffix:[@"." stringByAppendingString:ext]]) return YES;
    }
    return NO;
}

NSString *WriterPreviewHTML(NSString *text, NSString *uti, NSString *name) {
    if (text.length > 512 * 1024) text = [[text substringToIndex:512 * 1024] stringByAppendingString:@"\n\n…"];
    NSString *title = EscapeHTML(name.length ? name : @"Document");
    NSMutableString *body = [NSMutableString string];
    if (!IsMarkdown(uti, name)) {
        [body appendFormat:@"<pre>%@</pre>", EscapeHTML(text ?: @"")];
    } else {
        BOOL inCode = NO;
        unichar fenceChar = 0;
        NSUInteger fenceLength = 0;
        NSInteger listDepth = 0;
        unichar listKind = 0;
        for (NSString *raw in [(text ?: @"") componentsSeparatedByString:@"\n"]) {
            NSString *line = [raw hasSuffix:@"\r"] ? [raw substringToIndex:raw.length - 1] : raw;
            unichar delimiter = 0;
            NSUInteger markerLength = 0;
            NSString *info = nil;
            BOOL closer = NO;
            BOOL fence = FenceLine(line, &delimiter, &markerLength, &info, &closer);
            if (inCode) {
                if (fence && closer && delimiter == fenceChar && markerLength >= fenceLength) {
                    inCode = NO;
                    fenceChar = 0;
                    fenceLength = 0;
                    [body appendString:@"</code></pre>"];
                } else [body appendFormat:@"%@\n", EscapeHTML(line)];
                continue;
            }
            if (fence) {
                CloseLists(body, &listDepth, listKind);
                inCode = YES;
                fenceChar = delimiter;
                fenceLength = markerLength;
                NSCharacterSet *safe = [NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+-#"];
                if (info.length && [info rangeOfCharacterFromSet:[safe invertedSet]].location == NSNotFound)
                    [body appendFormat:@"<pre><code class=\"language-%@\">", EscapeHTML(info)];
                else [body appendString:@"<pre><code>"];
                continue;
            }
            if ([line hasPrefix:@"#"]) {
                NSUInteger level = 0;
                while (level < line.length && level < 6 && [line characterAtIndex:level] == '#') level++;
                if (level && (line.length == level || [line characterAtIndex:level] == ' ')) {
                    CloseLists(body, &listDepth, listKind);
                    NSString *content = InlineMarkdown(EscapeHTML([[line substringFromIndex:level] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]]));
                    [body appendFormat:@"<h%lu>%@</h%lu>", (unsigned long)level, content, (unsigned long)level];
                    continue;
                }
            }
            NSInteger depth = 0;
            unichar kind = 0;
            NSString *item = nil;
            if (ListLine(line, &depth, &kind, &item)) {
                AppendListItem(body, &listDepth, &listKind, depth, kind, InlineMarkdown(EscapeHTML(item)));
                continue;
            }
            CloseLists(body, &listDepth, listKind);
            if (!line.length) {
                [body appendString:@"<br>"];
                continue;
            }
            [body appendFormat:@"<p>%@</p>", InlineMarkdown(EscapeHTML(line))];
        }
        CloseLists(body, &listDepth, listKind);
        if (inCode) [body appendString:@"</code></pre>"];
    }
    return [NSString stringWithFormat:@"<!doctype html><html><head><meta charset=\"utf-8\"><title>%@</title><style>body{margin:0;padding:48px 64px;background:#f7f6f3;color:#1c1c1c;font:18px/1.55 Menlo,monospace}h1,h2,h3,h4,h5,h6{font-family:Georgia,serif;line-height:1.2}pre{white-space:pre-wrap}a{color:#1c1c1c}</style></head><body><article>%@</article></body></html>", title, body];
}

NSString *WriterReadText(NSURL *url) {
    NSString *text = [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:nil];
    if (!text) text = [NSString stringWithContentsOfURL:url encoding:NSUTF16StringEncoding error:nil];
    if (!text) {
        NSData *data = [NSData dataWithContentsOfURL:url];
        text = [[NSString alloc] initWithData:data encoding:NSISOLatin1StringEncoding];
    }
    return text ?: @"This file could not be read as text.";
}

OSStatus GeneratePreviewForURL(void *thisInterface, QLPreviewRequestRef preview, CFURLRef url, CFStringRef contentTypeUTI, CFDictionaryRef options) {
    (void)thisInterface; (void)options;
    @autoreleasepool {
        if (QLPreviewRequestIsCancelled(preview)) return noErr;
        NSURL *fileURL = (__bridge NSURL *)url;
        NSString *html = WriterPreviewHTML(WriterReadText(fileURL), (__bridge NSString *)contentTypeUTI, fileURL.lastPathComponent);
        NSData *data = [html dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *properties = @{
            (__bridge NSString *)kQLPreviewPropertyMIMETypeKey: @"text/html",
            (__bridge NSString *)kQLPreviewPropertyTextEncodingNameKey: @"UTF-8",
            (__bridge NSString *)kQLPreviewPropertyWidthKey: @800,
            (__bridge NSString *)kQLPreviewPropertyHeightKey: @640,
        };
        QLPreviewRequestSetDataRepresentation(preview, (__bridge CFDataRef)data, CFSTR("public.html"), (__bridge CFDictionaryRef)properties);
        return noErr;
    }
}

void CancelPreviewGeneration(void *thisInterface, QLPreviewRequestRef preview) {
    (void)thisInterface; (void)preview;
}

OSStatus GenerateThumbnailForURL(void *thisInterface, QLThumbnailRequestRef thumbnail, CFURLRef url, CFStringRef contentTypeUTI, CFDictionaryRef options, CGSize maxSize) {
    (void)thisInterface; (void)contentTypeUTI; (void)options;
    @autoreleasepool {
        if (QLThumbnailRequestIsCancelled(thumbnail)) return noErr;
        if (maxSize.width < 32 || maxSize.height < 32) maxSize = CGSizeMake(128, 128);
        NSURL *fileURL = (__bridge NSURL *)url;
        NSString *extension = fileURL.pathExtension.length ? fileURL.pathExtension : @"txt";
        NSDictionary *properties = @{(__bridge NSString *)kQLThumbnailPropertyExtensionKey: extension};
        CGContextRef context = QLThumbnailRequestCreateContext(thumbnail, maxSize, true, (__bridge CFDictionaryRef)properties);
        if (!context) return noErr;
        NSString *text = WriterReadText(fileURL);
        if (text.length > 500) text = [text substringToIndex:500];
        CGContextSetRGBFillColor(context, 0.97, 0.965, 0.95, 1);
        CGContextFillRect(context, CGRectMake(0, 0, maxSize.width, maxSize.height));
        CTFontRef font = CTFontCreateWithName(CFSTR("Menlo"), MAX(9, maxSize.width / 18.0), NULL);
        CGColorRef color = CGColorCreateGenericRGB(0.12, 0.12, 0.12, 1);
        NSAttributedString *attributed = [[NSAttributedString alloc] initWithString:text ?: @"" attributes:@{
            (__bridge id)kCTFontAttributeName: (__bridge id)font,
            (__bridge id)kCTForegroundColorAttributeName: (__bridge id)color,
        }];
        CTFramesetterRef framesetter = CTFramesetterCreateWithAttributedString((__bridge CFAttributedStringRef)attributed);
        CGMutablePathRef path = CGPathCreateMutable();
        CGPathAddRect(path, NULL, CGRectInset(CGRectMake(0, 0, maxSize.width, maxSize.height), 8, 8));
        CTFrameRef frame = CTFramesetterCreateFrame(framesetter, CFRangeMake(0, attributed.length), path, NULL);
        CGContextSaveGState(context);
        CGContextTranslateCTM(context, 0, maxSize.height);
        CGContextScaleCTM(context, 1, -1);
        CTFrameDraw(frame, context);
        CGContextRestoreGState(context);
        CFRelease(frame);
        CFRelease(path);
        CFRelease(framesetter);
        CFRelease(font);
        CGColorRelease(color);
        QLThumbnailRequestFlushContext(thumbnail, context);
        CGContextRelease(context);
        return noErr;
    }
}

void CancelThumbnailGeneration(void *thisInterface, QLThumbnailRequestRef thumbnail) {
    (void)thisInterface; (void)thumbnail;
}

typedef struct {
    void *conduitInterface;
    CFUUIDRef factoryID;
    UInt32 refCount;
} WriterQLPlugin;

static HRESULT WriterQLQueryInterface(void *thisInstance, REFIID iid, LPVOID *ppv);
static ULONG WriterQLAddRef(void *thisInstance);
static ULONG WriterQLRelease(void *thisInstance);

static QLGeneratorInterfaceStruct writerQLInterface = {
    NULL,
    WriterQLQueryInterface,
    WriterQLAddRef,
    WriterQLRelease,
    GenerateThumbnailForURL,
    CancelThumbnailGeneration,
    GeneratePreviewForURL,
    CancelPreviewGeneration,
};

static HRESULT WriterQLQueryInterface(void *thisInstance, REFIID iid, LPVOID *ppv) {
    CFUUIDRef interfaceID = CFUUIDCreateFromUUIDBytes(kCFAllocatorDefault, iid);
    if (CFEqual(interfaceID, kQLGeneratorCallbacksInterfaceID) || CFEqual(interfaceID, IUnknownUUID)) {
        WriterQLAddRef(thisInstance);
        *ppv = thisInstance;
        CFRelease(interfaceID);
        return S_OK;
    }
    *ppv = NULL;
    CFRelease(interfaceID);
    return E_NOINTERFACE;
}

static ULONG WriterQLAddRef(void *thisInstance) {
    WriterQLPlugin *plugin = thisInstance;
    plugin->refCount += 1;
    return plugin->refCount;
}

static ULONG WriterQLRelease(void *thisInstance) {
    WriterQLPlugin *plugin = thisInstance;
    plugin->refCount -= 1;
    if (plugin->refCount > 0) return plugin->refCount;
    CFUUIDRef factoryID = plugin->factoryID;
    free(plugin);
    if (factoryID) {
        CFPlugInRemoveInstanceForFactory(factoryID);
        CFRelease(factoryID);
    }
    return 0;
}

__attribute__((visibility("default"))) void *QuickLookGeneratorPluginFactory(CFAllocatorRef allocator, CFUUIDRef typeID) {
    (void)allocator;
    if (!CFEqual(typeID, kQLGeneratorTypeID)) return NULL;
    WriterQLPlugin *plugin = calloc(1, sizeof(WriterQLPlugin));
    plugin->conduitInterface = &writerQLInterface;
    plugin->factoryID = CFUUIDCreateFromString(kCFAllocatorDefault, CFSTR("A7C3E1B2-4D58-4F0A-9C21-6B8E5D4A3F10"));
    plugin->refCount = 1;
    CFPlugInAddInstanceForFactory(plugin->factoryID);
    return plugin;
}

const char *writer_preview_html_utf8(const char *text, const char *uti, const char *name) {
    @autoreleasepool {
        NSString *html = WriterPreviewHTML(
            text ? [NSString stringWithUTF8String:text] : @"",
            uti ? [NSString stringWithUTF8String:uti] : @"",
            name ? [NSString stringWithUTF8String:name] : @"");
        return strdup(html.UTF8String ?: "");
    }
}

#ifdef CLASSIC_QL_DUMP
int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc < 4) return 2;
        NSString *text = [NSString stringWithContentsOfFile:[NSString stringWithUTF8String:argv[1]] encoding:NSUTF8StringEncoding error:nil];
        const char *html = writer_preview_html_utf8(text.UTF8String, argv[2], argv[3]);
        fwrite(html, 1, strlen(html), stdout);
        free((void *)html);
        return 0;
    }
}
#endif
