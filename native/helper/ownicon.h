/* F329: ifizbox-helper own-icon <a|b> <dir>, your own app icon in the jailbreak build.
 *
 * Info.plist lists two alternate icons of loose PNGs, Icon-owna and Icon-ownb (native/icon/alternates.py OWN_SLOTS;
 * native/build.sh ships the primary icon in them). This copies <dir>/IconOwn60x60@2x.png and @3x.png, the picture
 * the app drew at 120 and 180 px in its own container, over <app>/IconOwn<A|B>60x60@2x.png and @3x.png; the app then
 * switches to that set quietly (Sources/AppIcon.swift). Info.plist never changes, so nothing is re-registered: a
 * uicache would close the running app (checked on the iPhone 7). The bundle is root's, so only the helper can write.
 *
 * Only those two files, only PNGs (the signature), regular files of at most HELPER_LAUNCH_MAX bytes, never through a
 * symlink, `dir` absolute without "..". Both are read before either is written; each lands by temp file + rename
 * (launch.h's). Runs nothing. Header only, so main.c and test_ownicon.py's build share it.
 * SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef IFIZBOX_HELPER_OWNICON_H
#define IFIZBOX_HELPER_OWNICON_H

#include "launch.h"

static const char *const helper_own_scales[] = {"@2x", "@3x", NULL};

static int helper_own_slot_ok(const char *slot) { return slot && (!strcmp(slot, "a") || !strcmp(slot, "b")); }

static int helper_own_dir_ok(const char *dir) {
    size_t n = dir ? strlen(dir) : 0;
    if (n < 2 || n > 900 || dir[0] != '/') return 0;
    if (strstr(dir, "/../") || strstr(dir, "/./") || !strcmp(dir + n - 3, "/..") || !strcmp(dir + n - 2, "/."))
        return 0;
    for (size_t i = 0; i < n; i++)
        if ((unsigned char)dir[i] < 0x20) return 0;
    return 1;
}

static int helper_own_icon(const char *app, const char *slot, const char *dir, const char **err) {
    static const unsigned char sig[8] = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};
    if (!helper_own_slot_ok(slot)) { *err = "bad slot (a or b)"; return -1; }
    if (!helper_own_dir_ok(dir)) { *err = "bad folder (an absolute path)"; return -1; }
    unsigned char *bufs[2] = {0};
    size_t lens[2] = {0};
    char path[PATH_MAX];
    int rc = 0;
    for (int i = 0; i < 2 && !rc; i++) {
        if ((size_t)snprintf(path, sizeof path, "%s/IconOwn60x60%s.png", dir, helper_own_scales[i]) >= sizeof path) {
            *err = "path too long"; rc = -1; break;
        }
        if (!(bufs[i] = helper_launch_read(path, &lens[i], err))) { *err = "can't read the picture"; rc = -1; break; }
        if (lens[i] < sizeof sig || memcmp(bufs[i], sig, sizeof sig)) { *err = "the picture isn't a PNG"; rc = -1; }
    }
    for (int i = 0; i < 2 && !rc; i++) {
        if ((size_t)snprintf(path, sizeof path, "%s/IconOwn%c60x60%s.png", app, slot[0] - 'a' + 'A',
                             helper_own_scales[i]) >= sizeof path) { *err = "path too long"; rc = -1; break; }
        struct stat st;
        if (lstat(path, &st) == 0 && !S_ISREG(st.st_mode)) { *err = "the app's icon file isn't a regular file"; rc = -1; break; }
        if (helper_launch_write(path, bufs[i], lens[i], err)) { *err = "can't write the app's icon file"; rc = -1; }
    }
    for (int i = 0; i < 2; i++) free(bufs[i]);
    return rc;
}

/* ifizbox-helper own-icon-refresh: SpringBoard keeps the picture it last drew for a set, so a set the app wrote again
 * shows the old picture until the app is registered again (checked on the iPhone 7). That is uicache -p <app>,
 * which closes the running app, so the app asks for it only once it went to the background. The helper leaves the
 * app's session (setsid, as outlive_caller in main.c) and starts <prefix>/usr/bin/uicache -p <app> without waiting:
 * it carries on after iOS closes the app. Returns -1 if uicache couldn't be started. */
static int helper_own_refresh(const char *prefix, const char *app, const char **err) {
    char path[PATH_MAX];
    if ((size_t)snprintf(path, sizeof path, "%s/usr/bin/uicache", prefix) >= sizeof path) { *err = "path too long"; return -1; }
    if (access(path, X_OK)) { *err = "no uicache"; return -1; }
    setsid();
    fflush(stdout);
    fflush(stderr);
    pid_t pid = fork();
    if (pid < 0) { *err = "can't fork"; return -1; }
    if (pid == 0) {
        int null = open("/dev/null", O_RDWR);
        if (null >= 0) { dup2(null, 0); dup2(null, 1); dup2(null, 2); if (null > 2) close(null); }
        for (int fd = 3; fd < 256; fd++) close(fd); /* the app's pipes (status fd 3): nothing waits on uicache */
        execl(path, "uicache", "-p", app, (char *)NULL);
        _exit(127);
    }
    return 0;
}

#endif
