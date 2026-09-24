#import <Foundation/Foundation.h>
#import <QuickLook/QuickLook.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <QuickLookUI/QLPreviewProvider.h>
#import <QuickLookUI/QLPreviewingController.h>
#import <QuickLookUI/QLPreviewReply.h>
#import <QuickLookUI/QLFilePreviewRequest.h>

extern NSString *WriterPreviewHTML(NSString *text, NSString *uti, NSString *name);
extern NSString *WriterReadText(NSURL *url);

API_AVAILABLE(macos(12.0))
@interface WriterPreviewProvider : QLPreviewProvider <QLPreviewingController>
@end

@implementation WriterPreviewProvider
- (void)providePreviewForFileRequest:(QLFilePreviewRequest *)request completionHandler:(void (^)(QLPreviewReply *_Nullable, NSError *_Nullable))handler {
    NSString *uti = nil;
    [request.fileURL getResourceValue:&uti forKey:NSURLTypeIdentifierKey error:nil];
    NSString *html = WriterPreviewHTML(WriterReadText(request.fileURL), uti, request.fileURL.lastPathComponent);
    QLPreviewReply *reply = [[QLPreviewReply alloc] initWithDataOfContentType:UTTypeHTML contentSize:CGSizeMake(800, 640) dataCreationBlock:^NSData *(QLPreviewReply *reply, NSError **error) {
        (void)reply;
        (void)error;
        return [html dataUsingEncoding:NSUTF8StringEncoding];
    }];
    reply.title = request.fileURL.lastPathComponent;
    handler(reply, nil);
}
@end
