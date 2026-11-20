// The app-group and keychain fix (B211) the signers inject into a sideloaded app (web/app/core/groupfix.js plans it,
// web/app/websign-job.js and native/sign/IPASigner.swift put it in). A re-signed app keeps asking for the app groups
// and keychain access groups its original signature had (group.com.burbn.instagram, TEAM.com.burbn.instagram), which
// the user's profile can't give: iOS answers nil and errSecMissingEntitlement, and the app forgets its settings and
// its sign-in. Loaded at launch from Frameworks/, this:
//   - maps -[NSFileManager containerURLForSecurityApplicationGroupIdentifier:] for the original groups to the
//     profile's own group, or to Library/AppGroups/<group>/ in the app's own container when the profile has none;
//   - maps -[NSUserDefaults initWithSuiteName:] for them to the profile's group, or to a suite of the app's own
//     (ifizbox.appgroup.<group>, kept in its own Library/Preferences);
//   - strips kSecAttrAccessGroup from SecItemAdd/CopyMatching/Update/Delete, so keychain items land in the app's
//     default group (its application-identifier, the same on every re-sign with the same team and App ID).
// What to map comes from ifizbox-groupfix.plist beside this dylib: { groups: [original IDs], target: profile's group
// or "", keychain: bool }. The same folder and suite on every re-sign, so the data survives.
// Built by native/groupfix/build.sh into web/app/vendor/groupfix/.
// SPDX-License-Identifier: GPL-3.0-or-later
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#include <mach/mach.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <mach-o/nlist.h>
#include <string.h>

static NSSet<NSString *> *groups;
static NSString *target;

// Library/AppGroups/<group>/ in the app's own container, made with the Library folders a group container has.
static NSURL *ownFolder(NSString *group) {
    NSURL *u = [[NSURL fileURLWithPath:NSHomeDirectory() isDirectory:YES]
        URLByAppendingPathComponent:[@"Library/AppGroups" stringByAppendingPathComponent:group] isDirectory:YES];
    NSFileManager *fm = [NSFileManager defaultManager];
    for (NSString *sub in @[ @"Library/Preferences", @"Library/Caches" ]) {
        [fm createDirectoryAtURL:[u URLByAppendingPathComponent:sub isDirectory:YES] withIntermediateDirectories:YES
                      attributes:nil error:NULL];
    }
    return u;
}

static NSURL *(*origContainer)(id, SEL, NSString *);
static NSURL *fixContainer(id self, SEL cmd, NSString *group) {
    if (![group isKindOfClass:[NSString class]] || ![groups containsObject:group]) return origContainer(self, cmd, group);
    if (target) {
        NSURL *u = origContainer(self, cmd, target);
        if (u) return u;
    }
    return ownFolder(group);
}

static id (*origSuite)(id, SEL, NSString *);
static id fixSuite(id self, SEL cmd, NSString *name) {
    if ([name isKindOfClass:[NSString class]] && [groups containsObject:name]) {
        name = target ?: [@"ifizbox.appgroup." stringByAppendingString:name];
    }
    return origSuite(self, cmd, name);
}

static void swizzle(Class c, SEL sel, IMP imp, IMP *orig) {
    Method m = class_getInstanceMethod(c, sel);
    if (m) *orig = method_setImplementation(m, imp);
}

// ---- keychain: the query without kSecAttrAccessGroup ----

static CFDictionaryRef stripped(CFDictionaryRef q) {
    if (!q || CFGetTypeID(q) != CFDictionaryGetTypeID() || !CFDictionaryContainsKey(q, kSecAttrAccessGroup)) return NULL;
    CFMutableDictionaryRef m = CFDictionaryCreateMutableCopy(NULL, 0, q);
    CFDictionaryRemoveValue(m, kSecAttrAccessGroup);
    return m;
}

static OSStatus fixAdd(CFDictionaryRef a, CFTypeRef *r) {
    CFDictionaryRef s = stripped(a);
    OSStatus st = SecItemAdd(s ? s : a, r);
    if (s) CFRelease(s);
    return st;
}
static OSStatus fixCopyMatching(CFDictionaryRef q, CFTypeRef *r) {
    CFDictionaryRef s = stripped(q);
    OSStatus st = SecItemCopyMatching(s ? s : q, r);
    if (s) CFRelease(s);
    return st;
}
static OSStatus fixUpdate(CFDictionaryRef q, CFDictionaryRef a) {
    CFDictionaryRef s = stripped(q), t = stripped(a);
    OSStatus st = SecItemUpdate(s ? s : q, t ? t : a);
    if (s) CFRelease(s);
    if (t) CFRelease(t);
    return st;
}
static OSStatus fixDelete(CFDictionaryRef q) {
    CFDictionaryRef s = stripped(q);
    OSStatus st = SecItemDelete(s ? s : q);
    if (s) CFRelease(s);
    return st;
}

static const struct { const char *name; void *to; } hooks[] = {
    { "_SecItemAdd", (void *)fixAdd },
    { "_SecItemCopyMatching", (void *)fixCopyMatching },
    { "_SecItemUpdate", (void *)fixUpdate },
    { "_SecItemDelete", (void *)fixDelete },
};

// Points an image's symbol pointers (__got, __la_symbol_ptr) for SecItem* at the fixes, as fishhook (BSD) does:
// the app's executable and its own frameworks, never the shared cache or this dylib (its calls reach the real ones).
static void rebindSection(const struct section_64 *sect, intptr_t slide, const struct nlist_64 *symtab,
                          const char *strtab, const uint32_t *indirect) {
    const uint32_t *idx = indirect + sect->reserved1;
    void **ptrs = (void **)((uintptr_t)slide + sect->addr);
    size_t n = sect->size / sizeof(void *);
    for (size_t i = 0; i < n; i++) {
        uint32_t s = idx[i];
        if (s == INDIRECT_SYMBOL_ABS || s == INDIRECT_SYMBOL_LOCAL || s == (INDIRECT_SYMBOL_LOCAL | INDIRECT_SYMBOL_ABS)) continue;
        const char *name = strtab + symtab[s].n_un.n_strx;
        for (size_t h = 0; h < sizeof(hooks) / sizeof(hooks[0]); h++) {
            if (strcmp(name, hooks[h].name) != 0 || ptrs[i] == hooks[h].to) continue;
            vm_address_t page = (vm_address_t)&ptrs[i] & ~(vm_address_t)(vm_page_size - 1);
            vm_protect(mach_task_self(), page, vm_page_size, 0, VM_PROT_READ | VM_PROT_WRITE | VM_PROT_COPY);
            ptrs[i] = hooks[h].to;
        }
    }
}

static void rebindImage(const struct mach_header *mh, intptr_t slide) {
    Dl_info self;
    if (!dladdr((void *)rebindImage, &self) || self.dli_fbase == (void *)mh) return;
    if (mh->magic != MH_MAGIC_64 || (mh->flags & 0x80000000)) return; // MH_DYLIB_IN_CACHE
    const struct segment_command_64 *linkedit = NULL;
    const struct symtab_command *st = NULL;
    const struct dysymtab_command *dy = NULL;
    const struct load_command *lc = (const struct load_command *)((const struct mach_header_64 *)mh + 1);
    for (uint32_t i = 0; i < mh->ncmds; i++, lc = (const void *)((const char *)lc + lc->cmdsize)) {
        if (lc->cmd == LC_SEGMENT_64 && strcmp(((const struct segment_command_64 *)lc)->segname, SEG_LINKEDIT) == 0) linkedit = (const void *)lc;
        else if (lc->cmd == LC_SYMTAB) st = (const void *)lc;
        else if (lc->cmd == LC_DYSYMTAB) dy = (const void *)lc;
    }
    if (!linkedit || !st || !dy || !dy->nindirectsyms) return;
    uintptr_t base = (uintptr_t)slide + linkedit->vmaddr - linkedit->fileoff;
    const struct nlist_64 *symtab = (const void *)(base + st->symoff);
    const char *strtab = (const char *)(base + st->stroff);
    const uint32_t *indirect = (const void *)(base + dy->indirectsymoff);
    lc = (const struct load_command *)((const struct mach_header_64 *)mh + 1);
    for (uint32_t i = 0; i < mh->ncmds; i++, lc = (const void *)((const char *)lc + lc->cmdsize)) {
        if (lc->cmd != LC_SEGMENT_64) continue;
        const struct segment_command_64 *seg = (const void *)lc;
        if (strcmp(seg->segname, "__DATA") != 0 && strcmp(seg->segname, "__DATA_CONST") != 0) continue;
        const struct section_64 *sect = (const void *)(seg + 1);
        for (uint32_t j = 0; j < seg->nsects; j++) {
            uint32_t type = sect[j].flags & SECTION_TYPE;
            if (type == S_LAZY_SYMBOL_POINTERS || type == S_NON_LAZY_SYMBOL_POINTERS) rebindSection(&sect[j], slide, symtab, strtab, indirect);
        }
    }
}

__attribute__((constructor)) static void groupfixInit(void) {
    @autoreleasepool {
        Dl_info self;
        if (!dladdr((void *)groupfixInit, &self) || !self.dli_fname) return;
        NSString *dir = [[NSString stringWithUTF8String:self.dli_fname] stringByDeletingLastPathComponent];
        NSDictionary *c = [NSDictionary dictionaryWithContentsOfFile:[dir stringByAppendingPathComponent:@"ifizbox-groupfix.plist"]];
        NSArray *g = [c[@"groups"] isKindOfClass:[NSArray class]] ? c[@"groups"] : @[];
        groups = [NSSet setWithArray:g];
        NSString *t = c[@"target"];
        target = [t isKindOfClass:[NSString class]] && t.length ? t : nil;
        if (groups.count) {
            swizzle([NSFileManager class], @selector(containerURLForSecurityApplicationGroupIdentifier:), (IMP)fixContainer, (IMP *)&origContainer);
            swizzle([NSUserDefaults class], @selector(initWithSuiteName:), (IMP)fixSuite, (IMP *)&origSuite);
        }
        if ([c[@"keychain"] boolValue]) _dyld_register_func_for_add_image(rebindImage);
    }
}
