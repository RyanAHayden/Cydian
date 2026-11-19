/* R25 hand-test tool for the iPhone 7 (not part of iFizBox): ask installd to install or uninstall an app, and
 * print installd's own error text, so a test can see which check refused it.
 *   r25inst install <path/to/App.app or .ipa> <CFBundleIdentifier>
 *   r25inst uninstall <CFBundleIdentifier>
 * Same SPI and entitlements as native/helper/ipa.c (AppSync Unified's appinst), signed on the phone with ldid.
 * Build: see build.sh beside it. */
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <objc/message.h>
#include <objc/runtime.h>
#include <stdio.h>
#include <string.h>

static void print_error(id error) {
    if (!error) { puts("no error object"); return; }
    CFStringRef s = (CFStringRef)((id(*)(id, SEL))objc_msgSend)(error, sel_registerName("description"));
    char buf[8192];
    if (s && CFStringGetCString(s, buf, sizeof buf, kCFStringEncodingUTF8)) puts(buf);
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: r25inst install PATH ID | uninstall ID\n"); return 2; }
    dlopen("/System/Library/Frameworks/MobileCoreServices.framework/MobileCoreServices", RTLD_NOW);
    Class ws = objc_getClass("LSApplicationWorkspace");
    if (!ws) { puts("no LSApplicationWorkspace"); return 1; }
    id w = ((id(*)(Class, SEL))objc_msgSend)(ws, sel_registerName("defaultWorkspace"));
    id error = nil;
    BOOL ok;
    if (!strcmp(argv[1], "install") && argc == 4) {
        int dir = strstr(argv[2], ".ipa") == NULL;
        CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)argv[2], (CFIndex)strlen(argv[2]), dir);
        CFStringRef cid = CFStringCreateWithCString(NULL, argv[3], kCFStringEncodingUTF8);
        const void *keys[2] = {CFSTR("CFBundleIdentifier"), CFSTR("PackageType")};
        const void *vals[2] = {cid, CFSTR("Developer")};
        CFDictionaryRef opts = CFDictionaryCreate(NULL, keys, vals, dir ? 2 : 1, &kCFTypeDictionaryKeyCallBacks,
                                                  &kCFTypeDictionaryValueCallBacks);
        ok = ((BOOL(*)(id, SEL, id, id, id *))objc_msgSend)(
            w, sel_registerName("installApplication:withOptions:error:"), (id)url, (id)opts, &error);
    } else if (!strcmp(argv[1], "uninstall")) {
        CFStringRef cid = CFStringCreateWithCString(NULL, argv[2], kCFStringEncodingUTF8);
        ok = ((BOOL(*)(id, SEL, id, id))objc_msgSend)(w, sel_registerName("uninstallApplication:withOptions:"),
                                                      (id)cid, nil);
    } else {
        fprintf(stderr, "usage: r25inst install PATH ID | uninstall ID\n");
        return 2;
    }
    if (ok) { puts("ok"); return 0; }
    puts("refused:");
    print_error(error);
    return 1;
}
