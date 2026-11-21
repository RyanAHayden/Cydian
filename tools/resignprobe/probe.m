// The re-sign probe: a tiny app that writes a marker to every place an app keeps data and shows, at each launch,
// which markers it can still read. Signed again and again (tools/resignprobe/run.sh), it tells which re-sign loses
// which storage. Never shipped: a test tool for the sideload test phone (docs/iphone15.md).
//
// Stores (each marker holds the time it was first written and the application-identifier that wrote it):
//   doc        Documents/probe-marker.txt
//   prefs      NSUserDefaults standard (Library/Preferences)
//   grp-file   containerURLForSecurityApplicationGroupIdentifier: for the original group (ORIG_GROUP below)
//   grp-prefs  initWithSuiteName: ORIG_GROUP
//   real-file  the first app group the signature really has (shared by every app signed with that profile)
//   kc-plain   keychain item with no kSecAttrAccessGroup (default accessibility: when unlocked)
//   kc-afu     the same, kSecAttrAccessibleAfterFirstUnlock (what an app's background refresh can read)
//   kc-orig    kSecAttrAccessGroup = the original team's group (ORIG_TEAM.<bundle ID>), as an app hard-codes it
//   kc-seed    kSecAttrAccessGroup = <prefix of kc-plain's group>.<bundle ID>, the "bundle seed ID" lookup apps do
// Each row says kept (found from an earlier launch), NEW (missing, written now: lost if it was there before), OTHER
// (found, but another app wrote it: a store the two share) or FAIL (can't even write it). The report goes on screen, to the device log (lines starting "PROBE "), and to
// Documents/probe-report.json (UIFileSharingEnabled, so the desktop can pull it).
// Info.plist ProbeWipe = true makes this copy delete the probe's keychain items it can reach at its first launch, as
// many apps clear their keychain on a fresh install: it shows what a shared keychain group lets one app do to another.
// SPDX-License-Identifier: GPL-3.0-or-later
#import <UIKit/UIKit.h>
#import <Security/Security.h>
#include <dlfcn.h>

static NSString *const ORIG_GROUP = @"group.org.example.probe.original";
static NSString *const ORIG_TEAM = @"ABCDE12345";

static NSString *now(void) {
    NSISO8601DateFormatter *f = [NSISO8601DateFormatter new];
    f.timeZone = [NSTimeZone localTimeZone];
    return [f stringFromDate:[NSDate date]];
}

// The running signature's entitlement (SecTask, looked up at run time: not in the iOS SDK's headers).
static id entitlement(NSString *key) {
    typedef void *(*Create)(CFAllocatorRef);
    typedef CFTypeRef (*Copy)(void *, CFStringRef, CFErrorRef *);
    Create create = (Create)dlsym(RTLD_DEFAULT, "SecTaskCreateFromSelf");
    Copy copy = (Copy)dlsym(RTLD_DEFAULT, "SecTaskCopyValueForEntitlement");
    if (!create || !copy) return nil;
    void *t = create(NULL);
    if (!t) return nil;
    CFTypeRef v = copy(t, (__bridge CFStringRef)key, NULL);
    CFRelease(t);
    return CFBridgingRelease(v);
}

@interface Probe : NSObject
@property NSMutableArray<NSDictionary *> *rows;
@property NSString *writer;
@end

@implementation Probe

- (void)row:(NSString *)store status:(NSString *)status value:(NSString *)value extra:(NSString *)extra {
    NSMutableDictionary *r = [@{ @"store": store, @"status": status, @"value": value ?: @"" } mutableCopy];
    if (extra.length) r[@"extra"] = extra;
    [self.rows addObject:r];
}

- (NSString *)stamp { return [NSString stringWithFormat:@"%@ by %@ as %@", now(), NSBundle.mainBundle.bundleIdentifier, self.writer]; }

// "kept", or "OTHER" when the marker found was written by another app (a store shared between apps).
- (NSString *)found:(NSString *)value {
    NSString *mine = [NSString stringWithFormat:@" by %@ as ", NSBundle.mainBundle.bundleIdentifier];
    return [value containsString:@" by "] && ![value containsString:mine] && [value containsString:@" as "] ? @"OTHER" : @"kept";
}

- (void)file:(NSString *)store dir:(NSURL *)dir {
    if (!dir) { [self row:store status:@"FAIL" value:nil extra:@"no folder (nil URL)"]; return; }
    NSURL *u = [dir URLByAppendingPathComponent:@"probe-marker.txt"];
    NSString *have = [NSString stringWithContentsOfURL:u encoding:NSUTF8StringEncoding error:NULL];
    if (have.length) { [self row:store status:[self found:have] value:have extra:dir.path]; return; }
    NSError *e = nil;
    NSString *v = [self stamp];
    BOOL ok = [v writeToURL:u atomically:YES encoding:NSUTF8StringEncoding error:&e];
    [self row:store status:ok ? @"NEW" : @"FAIL" value:ok ? v : nil extra:ok ? dir.path : e.localizedDescription];
}

- (void)defaults:(NSString *)store suite:(NSUserDefaults *)d {
    if (!d) { [self row:store status:@"FAIL" value:nil extra:@"suite is nil"]; return; }
    NSString *have = [d stringForKey:@"probe.marker"];
    if (have.length) { [self row:store status:[self found:have] value:have extra:nil]; return; }
    NSString *v = [self stamp];
    [d setObject:v forKey:@"probe.marker"];
    [d synchronize];
    [self row:store status:@"NEW" value:v extra:nil];
}

- (NSDictionary *)query:(NSString *)service group:(NSString *)group {
    NSMutableDictionary *q = [@{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
                                 (__bridge id)kSecAttrService: service, (__bridge id)kSecAttrAccount: @"probe" } mutableCopy];
    if (group) q[(__bridge id)kSecAttrAccessGroup] = group;
    return q;
}

// The item's value and the access group it really sits in, or nil.
- (NSArray *)readKeychain:(NSString *)service group:(NSString *)group status:(OSStatus *)st {
    NSMutableDictionary *q = [[self query:service group:group] mutableCopy];
    q[(__bridge id)kSecReturnAttributes] = @YES;
    q[(__bridge id)kSecReturnData] = @YES;
    CFTypeRef out = NULL;
    *st = SecItemCopyMatching((__bridge CFDictionaryRef)q, &out);
    if (*st != errSecSuccess) return nil;
    NSDictionary *a = CFBridgingRelease(out);
    NSString *v = [[NSString alloc] initWithData:a[(__bridge id)kSecValueData] encoding:NSUTF8StringEncoding];
    return @[ v ?: @"", a[(__bridge id)kSecAttrAccessGroup] ?: @"?" ];
}

- (NSString *)keychain:(NSString *)store service:(NSString *)service group:(NSString *)group accessible:(CFStringRef)acc {
    OSStatus st;
    NSArray *have = [self readKeychain:service group:group status:&st];
    if (have) { [self row:store status:[self found:have[0]] value:have[0] extra:[@"in " stringByAppendingString:have[1]]]; return have[1]; }
    NSMutableDictionary *add = [[self query:service group:group] mutableCopy];
    NSString *v = [self stamp];
    add[(__bridge id)kSecValueData] = [v dataUsingEncoding:NSUTF8StringEncoding];
    if (acc) add[(__bridge id)kSecAttrAccessible] = (__bridge id)acc;
    OSStatus as = SecItemAdd((__bridge CFDictionaryRef)add, NULL);
    if (as != errSecSuccess) {
        [self row:store status:@"FAIL" value:nil extra:[NSString stringWithFormat:@"read %d, add %d%@", (int)st, (int)as, group ? [@" group " stringByAppendingString:group] : @""]];
        return nil;
    }
    have = [self readKeychain:service group:group status:&st];
    [self row:store status:@"NEW" value:v extra:[NSString stringWithFormat:@"read %d before; in %@", (int)st, have ? have[1] : @"?"]];
    return have[1];
}

// Every generic-password item this signature can see: what another app signed with the same profile can reach.
- (NSArray *)visible {
    NSDictionary *q = @{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll,
                         (__bridge id)kSecReturnAttributes: @YES };
    CFTypeRef out = NULL;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)q, &out) != errSecSuccess) return @[];
    NSMutableArray *l = [NSMutableArray array];
    for (NSDictionary *a in (__bridge_transfer NSArray *)out) {
        [l addObject:[NSString stringWithFormat:@"%@ in %@", a[(__bridge id)kSecAttrService] ?: @"-", a[(__bridge id)kSecAttrAccessGroup] ?: @"?"]];
    }
    return [l sortedArrayUsingSelector:@selector(compare:)];
}

- (NSDictionary *)run {
    self.rows = [NSMutableArray array];
    NSString *appID = entitlement(@"application-identifier");
    self.writer = appID ?: @"?";
    NSString *bid = NSBundle.mainBundle.bundleIdentifier;
    NSUserDefaults *std = NSUserDefaults.standardUserDefaults;
    NSInteger launches = [std integerForKey:@"probe.launches"] + 1;
    [std setInteger:launches forKey:@"probe.launches"];

    NSString *wiped = nil;
    if ([[NSBundle.mainBundle objectForInfoDictionaryKey:@"ProbeWipe"] boolValue] && ![std boolForKey:@"probe.wiped"]) {
        // Only the probes' own items (services probe.*), so the test phone's other apps keep theirs.
        NSMutableArray *done = [NSMutableArray array];
        for (NSString *svc in @[ @"probe.plain", @"probe.afu", @"probe.orig", @"probe.seed" ]) {
            OSStatus st = SecItemDelete((__bridge CFDictionaryRef) @{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
                                                                       (__bridge id)kSecAttrService: svc });
            [done addObject:[NSString stringWithFormat:@"%@ %d", svc, (int)st]];
        }
        [std setBool:YES forKey:@"probe.wiped"];
        wiped = [@"deleted the probe items it can reach: " stringByAppendingString:[done componentsJoinedByString:@", "]];
    }

    NSURL *docs = [NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
    [self file:@"doc" dir:docs];
    [self defaults:@"prefs" suite:std];
    [self file:@"grp-file" dir:[NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:ORIG_GROUP]];
    [self defaults:@"grp-prefs" suite:[[NSUserDefaults alloc] initWithSuiteName:ORIG_GROUP]];
    NSArray *groups = entitlement(@"com.apple.security.application-groups");
    NSString *real = [groups isKindOfClass:NSArray.class] ? [groups filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"SELF != %@", ORIG_GROUP]].firstObject : nil;
    if (real) [self file:@"real-file" dir:[NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:real]];
    else [self row:@"real-file" status:@"none" value:nil extra:@"the signature has no app group"];
    NSString *plainGroup = [self keychain:@"kc-plain" service:@"probe.plain" group:nil accessible:NULL];
    [self keychain:@"kc-afu" service:@"probe.afu" group:nil accessible:kSecAttrAccessibleAfterFirstUnlock];
    [self keychain:@"kc-orig" service:@"probe.orig" group:[NSString stringWithFormat:@"%@.%@", ORIG_TEAM, bid] accessible:NULL];
    NSString *seed = [plainGroup componentsSeparatedByString:@"."].firstObject;
    if (seed.length) [self keychain:@"kc-seed" service:@"probe.seed" group:[NSString stringWithFormat:@"%@.%@", seed, bid] accessible:NULL];
    else [self row:@"kc-seed" status:@"FAIL" value:nil extra:@"no group for kc-plain"];

    NSMutableDictionary *r = [@{ @"bundleID": bid ?: @"", @"launch": @(launches), @"at": now(), @"appID": appID ?: @"?",
                                 @"keychainGroups": entitlement(@"keychain-access-groups") ?: @[], @"appGroups": groups ?: @[],
                                 @"rows": self.rows, @"visible": [self visible],
                                 @"groupfix": @([NSFileManager.defaultManager fileExistsAtPath:
                                     [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Frameworks/ifizbox-groupfix.plist"]]) } mutableCopy];
    if (wiped) r[@"wiped"] = wiped;
    NSData *json = [NSJSONSerialization dataWithJSONObject:r options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:NULL];
    [json writeToURL:[docs URLByAppendingPathComponent:@"probe-report.json"] atomically:YES];
    // Every launch's report, a line each, so a check reads the first launch after an install too.
    NSData *line = [NSJSONSerialization dataWithJSONObject:r options:NSJSONWritingSortedKeys error:NULL];
    NSURL *logURL = [docs URLByAppendingPathComponent:@"probe-log.jsonl"];
    NSFileHandle *h = [NSFileHandle fileHandleForWritingToURL:logURL error:NULL];
    if (!h) { [NSData.data writeToURL:logURL atomically:NO]; h = [NSFileHandle fileHandleForWritingToURL:logURL error:NULL]; }
    [h seekToEndOfFile];
    [h writeData:line];
    [h writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
    [h closeFile];
    NSLog(@"PROBE %@", [[NSString alloc] initWithData:line encoding:NSUTF8StringEncoding]);
    return r;
}

+ (NSString *)text:(NSDictionary *)r {
    NSMutableString *s = [NSMutableString stringWithFormat:@"%@  launch %@\n%@\napp ID %@\nkeychain %@\ngroups %@\ngroup fix %@\n%@\n",
                          r[@"bundleID"], r[@"launch"], r[@"at"], r[@"appID"], [r[@"keychainGroups"] componentsJoinedByString:@", "],
                          [r[@"appGroups"] componentsJoinedByString:@", "], [r[@"groupfix"] boolValue] ? @"yes" : @"no", r[@"wiped"] ?: @""];
    for (NSDictionary *row in r[@"rows"]) {
        [s appendFormat:@"\n%-9@ %-4@ %@\n          %@", row[@"store"], row[@"status"], row[@"value"], row[@"extra"] ?: @""];
    }
    [s appendString:@"\n\nVisible keychain items:\n"];
    for (NSString *v in r[@"visible"]) [s appendFormat:@"  %@\n", v];
    return s;
}
@end

// iOS 27 stops an app built with its SDK that has no scene lifecycle, so the window lives in a scene delegate.
@interface AppDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation AppDelegate
- (BOOL)application:(UIApplication *)app didFinishLaunchingWithOptions:(NSDictionary *)opts { return YES; }
@end

@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@property UITextView *text;
@property BOOL shown;
@end

@implementation SceneDelegate
- (void)refresh {
    NSDictionary *r = [[Probe new] run];
    self.text.text = [Probe text:r];
    NSUInteger lost = 0, kept = 0;
    for (NSDictionary *row in r[@"rows"]) {
        if ([row[@"status"] isEqual:@"kept"]) kept++;
        else if (![row[@"status"] isEqual:@"none"]) lost++;
    }
    // Green: every marker kept. Red: something is new or failing (the first launch is red too).
    self.text.backgroundColor = lost == 0 && kept > 0 ? [UIColor colorWithRed:0.85 green:1 blue:0.85 alpha:1]
                                                      : [UIColor colorWithRed:1 green:0.88 blue:0.88 alpha:1];
}

- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)opts {
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    UIViewController *vc = [UIViewController new];
    self.text = [[UITextView alloc] initWithFrame:vc.view.bounds];
    self.text.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.text.editable = NO;
    self.text.font = [UIFont monospacedSystemFontOfSize:11 weight:UIFontWeightRegular];
    self.text.textColor = UIColor.blackColor;
    self.text.textContainerInset = UIEdgeInsetsMake(60, 6, 30, 6);
    [vc.view addSubview:self.text];
    self.window.rootViewController = vc;
    [self.window makeKeyAndVisible];
    [self refresh];
}

// Coming back to the front checks again (a lock and unlock, a while in the background); not the first time, which
// comes with every launch right after willConnectToSession.
- (void)sceneWillEnterForeground:(UIScene *)scene {
    if (self.shown) [self refresh];
    self.shown = YES;
}
@end

int main(int argc, char *argv[]) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(AppDelegate.class)); }
}
