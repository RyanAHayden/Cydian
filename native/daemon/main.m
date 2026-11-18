/* cydian-upgrades (N5): Cydian's background upgrade check, a launchd daemon running as root.
 *
 *   cydian-upgrades [--force] [--no-update] [--dry-run]
 *
 * launchd starts it every hour and at load (com.ryha.cydian.upgrades.plist); it does the check when the last good
 * one is 23 hours old or more (upgrades.h UPD_INTERVAL; --force checks now). The check:
 *   1. apt-get update (10 minutes at most; --no-update skips it). When it fails (a source down, no network, apt's
 *      lock held by an install) the check goes on with the lists there are.
 *   2. apt-get -s -o Debug::NoLocking=1 dist-upgrade: the plan's "Inst <id> [<from>] (<to> ...)" lines are the
 *      upgrades (upgrades.c). apt leaves held packages (Ignored Upgrades) out.
 *   3. Names from dpkg's status, then the badge on Cydian's icon becomes the count (0 clears it), and when an
 *      upgrade is new since the last notification a local notification goes up for com.ryha.cydian:
 *      "3 Upgrades" / "3 upgrades: A, B and C." (the words of web/push.py). --dry-run prints them instead.
 *   4. <prefix>/var/lib/cydian/upgrades.state keeps the time of the check and the id=version pairs shown.
 *
 * The notification and badge go through UNUserNotificationCenter's private -initWithBundleIdentifier:, which
 * usernotificationsd allows for a process entitled with com.apple.private.usernotifications.bundle-identifiers
 * (entitlements.plist here). Cydian must have asked for notification permission once, or iOS drops them.
 * SPDX-License-Identifier: GPL-3.0-or-later */
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

#include "upgrades.h"

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdarg.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef CYDIAN_PREFIX
#define CYDIAN_PREFIX "/var/jb"
#endif
#define BUNDLE_ID @"com.ryha.cydian"
#define NOTE_ID @"cydian-upgrades" /* one notification, replaced by the next (device-check.js TAG) */
#define UPDATE_SECONDS 600
#define SIMULATE_SECONDS 120
#define OUTPUT_MAX (16 << 20)

extern char **environ;

@interface UNUserNotificationCenter (CydianPrivate)
- (instancetype)initWithBundleIdentifier:(NSString *)bundleIdentifier;
- (void)setBadgeNumber:(NSNumber *)number withCompletionHandler:(void (^)(NSError *))handler; /* before iOS 16 */
@end

static void say(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void say(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    NSString *s = [[NSString alloc] initWithFormat:@(fmt) arguments:ap];
    va_end(ap);
    NSLog(@"cydian-upgrades: %@", s); /* the system log, and stderr (launchd's StandardErrorPath) */
}

/* Run argv (argv[0] a full path) with a clean environment, stdin /dev/null; stdout into *out (NULL: discarded),
 * stderr discarded. Kills it after `seconds`. Returns the exit status, or -1. */
static int run(const char *const argv[], int seconds, NSMutableData *out) {
    static char path_env[1024];
    snprintf(path_env, sizeof path_env,
             "PATH=%1$s/usr/bin:%1$s/bin:%1$s/usr/sbin:%1$s/sbin:/usr/bin:/bin:/usr/sbin:/sbin", CYDIAN_PREFIX);
    char *env[] = {path_env, "HOME=/var/root", "USER=root", "LOGNAME=root", "LANG=C",
                   "DEBIAN_FRONTEND=noninteractive", NULL};
    int pipefd[2] = {-1, -1};
    if (out && pipe(pipefd)) return -1;
    posix_spawn_file_actions_t fa;
    posix_spawn_file_actions_init(&fa);
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
    if (out) posix_spawn_file_actions_adddup2(&fa, pipefd[1], 1);
    else posix_spawn_file_actions_addopen(&fa, 1, "/dev/null", O_WRONLY, 0);
    posix_spawn_file_actions_addopen(&fa, 2, "/dev/null", O_WRONLY, 0);
    if (out) { posix_spawn_file_actions_addclose(&fa, pipefd[0]); posix_spawn_file_actions_addclose(&fa, pipefd[1]); }
    pid_t pid;
    int err = posix_spawn(&pid, argv[0], &fa, NULL, (char *const *)argv, env);
    posix_spawn_file_actions_destroy(&fa);
    if (out) close(pipefd[1]);
    if (err) {
        say("%s: %s", argv[0], strerror(err));
        if (out) close(pipefd[0]);
        return -1;
    }
    time_t deadline = time(NULL) + seconds;
    if (out) {
        fcntl(pipefd[0], F_SETFL, O_NONBLOCK);
        char buf[16384];
        for (;;) {
            ssize_t n = read(pipefd[0], buf, sizeof buf);
            if (n > 0) { if (out.length < OUTPUT_MAX) [out appendBytes:buf length:(NSUInteger)n]; continue; }
            if (n == 0) break;
            if (errno != EAGAIN && errno != EINTR) break;
            if (time(NULL) > deadline) break;
            usleep(50000);
        }
        close(pipefd[0]);
    }
    int status = 0;
    for (;;) {
        pid_t r = waitpid(pid, &status, WNOHANG);
        if (r == pid) break;
        if (r < 0 && errno != EINTR) return -1;
        if (time(NULL) > deadline) {
            say("%s took more than %d s, stopped", argv[0], seconds);
            kill(pid, SIGKILL);
            waitpid(pid, &status, 0);
            return -1;
        }
        usleep(100000);
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

static NSString *readText(NSString *path) {
    NSData *d = [NSData dataWithContentsOfFile:path];
    return d ? [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] : nil;
}

/* Wait for a completion handler, 15 s at most. */
static void await(void (^start)(dispatch_block_t done)) {
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    start(^{ dispatch_semaphore_signal(sem); });
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));
}

static void setBadge(UNUserNotificationCenter *center, int n) {
    if (@available(iOS 16.0, *)) {
        await(^(dispatch_block_t done) {
            [center setBadgeCount:n withCompletionHandler:^(NSError *e) { if (e) say("badge: %s", e.description.UTF8String); done(); }];
        });
    } else if ([center respondsToSelector:@selector(setBadgeNumber:withCompletionHandler:)]) {
        await(^(dispatch_block_t done) {
            [center setBadgeNumber:@(n) withCompletionHandler:^(NSError *e) { if (e) say("badge: %s", e.description.UTF8String); done(); }];
        });
    }
}

static void post(UNUserNotificationCenter *center, int n, const char *title, const char *body) {
    UNMutableNotificationContent *c = [UNMutableNotificationContent new];
    c.title = @(title);
    c.body = @(body);
    c.badge = @(n);
    c.sound = UNNotificationSound.defaultSound;
    c.threadIdentifier = NOTE_ID;
    c.userInfo = @{@"url": @"#/changes"}; /* where the app's Changes tab is, for a tap handler */
    UNNotificationRequest *req = [UNNotificationRequest requestWithIdentifier:NOTE_ID content:c trigger:nil];
    await(^(dispatch_block_t done) {
        [center addNotificationRequest:req withCompletionHandler:^(NSError *e) {
            if (e) say("notification: %s", e.description.UTF8String);
            done();
        }];
    });
}

static struct upd_list list;

int main(int argc, char *argv[]) {
    @autoreleasepool {
        int force = 0, update = 1, dry = 0;
        for (int i = 1; i < argc; i++) {
            if (!strcmp(argv[i], "--force")) force = 1;
            else if (!strcmp(argv[i], "--no-update")) update = 0;
            else if (!strcmp(argv[i], "--dry-run")) dry = 1;
            else { fprintf(stderr, "usage: cydian-upgrades [--force] [--no-update] [--dry-run]\n"); return 64; }
        }
        umask(022);
        NSString *dir = @CYDIAN_PREFIX "/var/lib/cydian";
        NSString *statePath = [dir stringByAppendingPathComponent:@"upgrades.state"];
        mkdir(dir.fileSystemRepresentation, 0755);

        /* One run at a time (RunAtLoad and the interval can meet, or a hand-run --force). */
        int lock = open([dir stringByAppendingPathComponent:@"upgrades.lock"].fileSystemRepresentation,
                        O_RDWR | O_CREAT | O_CLOEXEC, 0644);
        if (lock < 0 || flock(lock, LOCK_EX | LOCK_NB)) { say("another check is running"); return 0; }

        NSString *state = readText(statePath);
        long now = (long)time(NULL);
        if (!force && !upd_due(now, upd_state_last(state.UTF8String))) return 0;

        const char *aptGet = CYDIAN_PREFIX "/usr/bin/apt-get";
        if (update) {
            const char *up[] = {aptGet, "-q", "update", NULL};
            int st = run(up, UPDATE_SECONDS, nil);
            /* Partly failed (one source down, no network): count from the lists there are, as Cydia's Changes does
             * after a refresh with errors. A broken source would otherwise stop the check for good. */
            if (st != 0) say("apt-get update failed (%d); counting from the lists there are", st);
        }
        NSMutableData *plan = [NSMutableData data];
        const char *sim[] = {aptGet, "-s", "-q", "-o", "Debug::NoLocking=1", "dist-upgrade", NULL};
        int st = run(sim, SIMULATE_SECONDS, plan);
        if (st != 0) { say("apt-get -s dist-upgrade failed (%d); trying again later", st); return 0; }
        [plan appendBytes:"" length:1];
        upd_parse_simulation(plan.bytes, &list);
        upd_names_from_status(readText(@CYDIAN_PREFIX "/var/lib/dpkg/status").UTF8String, &list);

        char title[UPD_TEXT], body[UPD_TEXT];
        upd_title(list.n, title, sizeof title);
        upd_body(&list, body, sizeof body);
        int fresh = upd_fresh(&list, state.UTF8String);
        say("%d upgrades%s", list.n, fresh ? ", new since the last notification" : "");
        if (dry) {
            printf("%d\n%s\n%s\n%s\n", list.n, fresh ? "fresh" : "seen", title, body);
            return 0;
        }

        UNUserNotificationCenter *center = [[UNUserNotificationCenter alloc] initWithBundleIdentifier:BUNDLE_ID];
        if (!center) say("no notification center for " "com.ryha.cydian");
        else if (fresh) post(center, list.n, title, body);
        else setBadge(center, list.n);

        size_t need = upd_state(&list, now, NULL, 0);
        NSMutableData *out = [NSMutableData dataWithLength:need + 1];
        upd_state(&list, now, out.mutableBytes, need + 1);
        out.length = need;
        NSError *e = nil;
        if (![out writeToFile:statePath options:NSDataWritingAtomic error:&e]) say("state: %s", e.description.UTF8String);
        return 0;
    }
}
