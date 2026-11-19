/* F59: ifizbox-helper install-ipa <path>: install an IPA the app downloaded, as AppSync's appinst does
 * (docs/sideload.md, "How jailbreak installers do it"): [[LSApplicationWorkspace defaultWorkspace]
 * installApplication:withOptions:error:] with appinst's entitlements on the helper (helper/entitlements.plist).
 *
 *   1. Open the IPA without following links: a regular file, one link, owned by the user who owns its directory
 *      (mobile), never root. Copied into a fresh root-owned directory under HELPER_IPA_WORK, so nothing the caller
 *      does afterwards changes what gets installed.
 *   2. unzip runs as that user (not root) into pkg/ beside the copy, so a hostile zip (symlinks, "../") can only
 *      write where the user already can. CFBundleIdentifier comes from Payload/<one>.app/Info.plist, read with
 *      O_NOFOLLOW.
 *   3. With AppSync Unified (installd takes any signature): install the root-owned copy, as appinst does; but
 *      installd still wants an application-identifier entitlement (B59), so a main binary without one is
 *      fakesigned with `ldid -M -S` on the whole .app (as the user) and the unpacked .app installed instead.
 *      Without it: ad hoc sign the .app with ldid (as TrollStore Lite does: `ldid -s`, keeping the entitlements, run
 *      as the user too) and install the unpacked .app (PackageType Developer). No ldid, or installd refuses the ad
 *      hoc app: exit HELPER_EX_ADHOC with a line saying the jailbreak can't install ad hoc apps without AppSync.
 *
 * Progress goes to fd 3 (when open) as pmstatus:<bundle id or "ipa">:<percent>:<text>, like apt's.
 * Off iOS (the tests) the last step only prints what it would install; the rest runs as on the phone.
 * SPDX-License-Identifier: GPL-3.0-or-later */
#include "ipa.h"
#include "policy.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <objc/message.h>
#include <objc/runtime.h>
void *objc_autoreleasePoolPush(void);
void objc_autoreleasePoolPop(void *pool);
#endif

#define IPA_MAX_SIZE (8LL << 30)     /* bigger than any App Store app */
#define IPA_PLIST_MAX (4 << 20)

static int status_fd = -1;

static void progress(const char *id, int pct, const char *text) {
    if (status_fd < 0) return;
    dprintf(status_fd, "pmstatus:%s:%d:%s\n", id && *id ? id : "ipa", pct, text);
}

static int fail(const char **err, const char *msg) { *err = msg; return HELPER_EX_IOERR; }

/* Run argv[0] (an absolute path) as uid/gid with the helper's clean environment; its stdout/stderr are the
 * console. Returns its exit status, or -1 when it couldn't start. */
static int run_as(uid_t uid, gid_t gid, const char *cwd, char *const env[], const char *const argv[]) {
    pid_t pid = fork();
    if (pid < 0) return -1;
    if (pid == 0) {
        if (geteuid() == 0 && uid != 0) {
            if (setgroups(0, NULL) || setgid(gid) || setuid(uid)) _exit(126);
        }
        if (getuid() == 0 && uid != 0) _exit(126); /* never extract or sign as root */
        if (chdir(cwd)) _exit(126);
        execve(argv[0], (char *const *)argv, env);
        fprintf(stderr, "ifizbox-helper: %s: %s\n", argv[0], strerror(errno));
        _exit(126);
    }
    int st;
    while (waitpid(pid, &st, 0) < 0)
        if (errno != EINTR) return -1;
    return WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
}

int helper_ipa_bundle_id_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > 255 || s[0] == '.' || s[0] == '-') return 0;
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-'))
            return 0;
    }
    return 1;
}

/* CFBundleIdentifier of an Info.plist's bytes into out (size HELPER_NAME_MAX + 1); 0, or -1 when missing or bad.
 * On iOS any plist format (CFPropertyList); elsewhere the XML form only, enough for the tests' fixtures. */
int helper_ipa_plist_id(const char *data, size_t len, char *out, size_t size) {
    out[0] = 0;
#ifdef __APPLE__
    CFDataRef d = CFDataCreateWithBytesNoCopy(NULL, (const UInt8 *)data, (CFIndex)len, kCFAllocatorNull);
    CFPropertyListRef pl = d ? CFPropertyListCreateWithData(NULL, d, kCFPropertyListImmutable, NULL, NULL) : NULL;
    if (d) CFRelease(d);
    int ok = -1;
    if (pl && CFGetTypeID(pl) == CFDictionaryGetTypeID()) {
        CFTypeRef v = CFDictionaryGetValue((CFDictionaryRef)pl, CFSTR("CFBundleIdentifier"));
        if (v && CFGetTypeID(v) == CFStringGetTypeID() &&
            CFStringGetCString((CFStringRef)v, out, (CFIndex)size, kCFStringEncodingUTF8))
            ok = 0;
    }
    if (pl) CFRelease(pl);
    if (ok) return -1;
#else
    static const char key[] = "<key>CFBundleIdentifier</key>";
    const char *end = data + len, *k = NULL;
    for (const char *p = data; p + sizeof key - 1 <= end; p++)
        if (!memcmp(p, key, sizeof key - 1)) { k = p + sizeof key - 1; break; }
    if (!k) return -1;
    while (k < end && (*k == ' ' || *k == '\t' || *k == '\n' || *k == '\r')) k++;
    if (end - k < 8 || memcmp(k, "<string>", 8)) return -1;
    k += 8;
    const char *e = k;
    while (e < end && *e != '<') e++;
    if (e == end || (size_t)(e - k) >= size) return -1;
    memcpy(out, k, (size_t)(e - k));
    out[e - k] = 0;
#endif
    return helper_ipa_bundle_id_ok(out) ? 0 : -1;
}

/* pkg/Payload/<the one .app> (a real directory, not a link) into app; 0 or -1. */
static int find_app(const char *payload, char *app, size_t size) {
    DIR *d = opendir(payload);
    if (!d) return -1;
    int found = 0;
    struct dirent *de;
    while ((de = readdir(d))) {
        size_t n = strlen(de->d_name);
        if (n < 5 || strcmp(de->d_name + n - 4, ".app")) continue;
        char p[PATH_MAX];
        struct stat st;
        if ((size_t)snprintf(p, sizeof p, "%s/%s", payload, de->d_name) >= sizeof p) continue;
        if (lstat(p, &st) || !S_ISDIR(st.st_mode)) continue;
        if (found++) break;
        snprintf(app, size, "%s", p);
    }
    closedir(d);
    return found == 1 ? 0 : -1;
}

static int read_plist(const char *app, char *id, size_t size) {
    char p[PATH_MAX];
    if ((size_t)snprintf(p, sizeof p, "%s/Info.plist", app) >= sizeof p) return -1;
    int fd = open(p, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return -1;
    struct stat st;
    char *buf = NULL;
    int rc = -1;
    if (!fstat(fd, &st) && S_ISREG(st.st_mode) && st.st_size > 0 && st.st_size <= IPA_PLIST_MAX &&
        (buf = malloc((size_t)st.st_size))) {
        size_t got = 0;
        ssize_t n;
        while (got < (size_t)st.st_size && (n = read(fd, buf + got, (size_t)st.st_size - got)) > 0) got += (size_t)n;
        if (got == (size_t)st.st_size) rc = helper_ipa_plist_id(buf, got, id, size);
    }
    free(buf);
    close(fd);
    return rc;
}

static int exists(const char *prefix, const char *path) {
    char p[PATH_MAX];
    if ((size_t)snprintf(p, sizeof p, "%s%s", prefix, path) >= sizeof p) return 0;
    return access(p, F_OK) == 0;
}

int helper_ipa_appsync(const char *prefix) {
    return exists(prefix, "/Library/MobileSubstrate/DynamicLibraries/AppSyncUnified-installd.dylib") ||
           exists(prefix, "/usr/lib/TweakInject/AppSyncUnified-installd.dylib");
}

/* The last step: installd. 0, or -1 with the reason in why. */
static int install(const char *path, const char *bundle, int developer, char *why, size_t size) {
#ifdef __APPLE__
    void *pool = objc_autoreleasePoolPush();
    int rc = -1;
    dlopen("/System/Library/Frameworks/MobileCoreServices.framework/MobileCoreServices", RTLD_NOW);
    Class ws = objc_getClass("LSApplicationWorkspace");
    if (!ws) {
        snprintf(why, size, "LSApplicationWorkspace isn't there");
    } else {
        id w = ((id(*)(Class, SEL))objc_msgSend)(ws, sel_registerName("defaultWorkspace"));
        CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)path, (CFIndex)strlen(path), developer);
        CFStringRef cid = CFStringCreateWithCString(NULL, bundle, kCFStringEncodingUTF8);
        const void *keys[2] = {CFSTR("CFBundleIdentifier"), CFSTR("PackageType")};
        const void *vals[2] = {cid, CFSTR("Developer")};
        CFDictionaryRef opts = CFDictionaryCreate(NULL, keys, vals, developer ? 2 : 1, &kCFTypeDictionaryKeyCallBacks,
                                                  &kCFTypeDictionaryValueCallBacks);
        id error = nil;
        BOOL ok = ((BOOL(*)(id, SEL, id, id, id *))objc_msgSend)(
            w, sel_registerName("installApplication:withOptions:error:"), (id)url, (id)opts, &error);
        if (ok) rc = 0;
        else if (error) {
            CFStringRef s = (CFStringRef)((id(*)(id, SEL))objc_msgSend)(error, sel_registerName("localizedDescription"));
            if (!s || !CFStringGetCString(s, why, (CFIndex)size, kCFStringEncodingUTF8)) snprintf(why, size, "installd said no");
        } else {
            snprintf(why, size, "installd said no");
        }
        CFRelease(opts);
        CFRelease(cid);
        CFRelease(url);
    }
    objc_autoreleasePoolPop(pool);
    return rc;
#else
    /* The tests' stand-in for installd: says what it would install; a bundle id ending in ".refused" fails. */
    printf("install %s %s%s\n", developer ? "app" : "ipa", bundle, developer ? " (PackageType Developer)" : "");
    (void)path;
    size_t n = strlen(bundle);
    if (n >= 8 && !strcmp(bundle + n - 8, ".refused")) { snprintf(why, size, "test installd refused it"); return -1; }
    return 0;
#endif
}

static void remove_tree(const char *path) {
    struct stat st;
    if (lstat(path, &st)) return;
    if (S_ISDIR(st.st_mode)) {
        DIR *d = opendir(path);
        if (d) {
            struct dirent *de;
            while ((de = readdir(d))) {
                if (!strcmp(de->d_name, ".") || !strcmp(de->d_name, "..")) continue;
                char p[PATH_MAX];
                if ((size_t)snprintf(p, sizeof p, "%s/%s", path, de->d_name) < sizeof p) remove_tree(p);
            }
            closedir(d);
        }
        rmdir(path);
    } else {
        unlink(path);
    }
}

/* B59: run_as with argv's stdout captured into a malloc'd, NUL-terminated *out (at most max bytes; more fails).
 * Returns the exit status, or -1 when it couldn't start or said too much. */
static int run_as_capture(uid_t uid, gid_t gid, const char *cwd, char *const env[], const char *const argv[],
                          size_t max, char **out, size_t *len) {
    *out = NULL;
    *len = 0;
    int fds[2];
    if (pipe(fds)) return -1;
    fflush(stdout);
    pid_t pid = fork();
    if (pid < 0) { close(fds[0]); close(fds[1]); return -1; }
    if (pid == 0) {
        close(fds[0]);
        if (dup2(fds[1], 1) < 0) _exit(126);
        if (fds[1] != 1) close(fds[1]);
        int null = open("/dev/null", O_WRONLY);
        if (null >= 0) { dup2(null, 2); if (null != 2) close(null); } /* a probe: its complaints aren't the user's */
        if (geteuid() == 0 && uid != 0) {
            if (setgroups(0, NULL) || setgid(gid) || setuid(uid)) _exit(126);
        }
        if (getuid() == 0 && uid != 0) _exit(126);
        if (chdir(cwd)) _exit(126);
        execve(argv[0], (char *const *)argv, env);
        fprintf(stderr, "ifizbox-helper: %s: %s\n", argv[0], strerror(errno));
        _exit(126);
    }
    close(fds[1]);
    char *buf = malloc(max + 1);
    size_t got = 0;
    int over = !buf;
    char tmp[4096];
    ssize_t n;
    while ((n = read(fds[0], tmp, sizeof tmp)) != 0) {
        if (n < 0) { if (errno == EINTR) continue; over = 1; break; }
        if (over || got + (size_t)n > max) { over = 1; continue; } /* drain so the child can finish */
        memcpy(buf + got, tmp, (size_t)n);
        got += (size_t)n;
    }
    close(fds[0]);
    int st;
    while (waitpid(pid, &st, 0) < 0)
        if (errno != EINTR) { free(buf); return -1; }
    if (over) { free(buf); return -1; }
    buf[got] = 0;
    *out = buf;
    *len = got;
    return WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
}

/* B59: the team id a fakesigned app gets when it has none of its own (installd wants any 10 characters). */
#define IPA_FAKE_TEAM "FAKESIGNED"

int helper_ipa_team_ok(const char *s) {
    if (strlen(s) != 10) return 0;
    for (const char *p = s; *p; p++)
        if (!((*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9'))) return 0;
    return 1;
}

int helper_ipa_exe_ok(const char *s) {
    if (!helper_app_value_ok(s) || !strcmp(s, ".") || !strcmp(s, "..")) return 0;
    return strchr(s, '/') == NULL;
}

static int read_small(const char *path, char **buf, size_t *len);

/* B59: installd refuses an app whose main binary has no application-identifier entitlement, AppSync Unified or
 * not ("Application is missing the application-identifier entitlement"). Read the binary's entitlements with
 * `ldid -e` (as the user); when application-identifier is missing, fakesign the .app with `ldid -M -S<ent>`
 * (sealing the bundle: _CodeSignature/CodeResources), which keeps the app's own entitlements and adds application-identifier <team>.<id> and
 * com.apple.developer.team-identifier <team> (the app's own team id when it has a usable one).
 * Returns 0 when the binary already had it, 1 when it was fakesigned, or an exit code with *err. */
static int fakesign(const char *ldid, uid_t uid, gid_t gid, const char *pkg, const char *work, const char *app,
                    const char *id, char *const env[], const char **err) {
    char p[PATH_MAX], exe[HELPER_NAME_MAX + 1], bin[PATH_MAX], ent[PATH_MAX];
    char *info = NULL, *have = NULL;
    size_t ilen = 0, hlen = 0;
    if ((size_t)snprintf(p, sizeof p, "%s/Info.plist", app) >= sizeof p || read_small(p, &info, &ilen)) {
        *err = "can't read the app's Info.plist";
        return HELPER_EX_USAGE;
    }
    int bad = helper_plist_string(info, ilen, "CFBundleExecutable", exe, sizeof exe) || !helper_ipa_exe_ok(exe);
    free(info);
    if (bad) { *err = "no usable CFBundleExecutable in the app's Info.plist"; return HELPER_EX_USAGE; }
    struct stat st;
    if ((size_t)snprintf(bin, sizeof bin, "%s/%s", app, exe) >= sizeof bin || lstat(bin, &st) || !S_ISREG(st.st_mode)) {
        *err = "the app's CFBundleExecutable isn't a plain file in the app";
        return HELPER_EX_USAGE;
    }

    /* Unsigned binaries make ldid -e fail: no entitlements at all. */
    const char *show[] = {ldid, "-e", bin, NULL};
    int rc = run_as_capture(uid, gid, pkg, env, show, IPA_PLIST_MAX, &have, &hlen);
    char appid[512] = "", team[HELPER_NAME_MAX + 1] = "";
    if (rc == 0 && have && hlen) {
        if (helper_plist_string(have, hlen, "application-identifier", appid, sizeof appid)) appid[0] = 0;
        if (helper_plist_string(have, hlen, "com.apple.developer.team-identifier", team, sizeof team) ||
            !helper_ipa_team_ok(team))
            team[0] = 0;
    }
    free(have);
    if (appid[0]) return 0;
    if (!team[0]) snprintf(team, sizeof team, "%s", IPA_FAKE_TEAM);

    progress(id, 45, "Adding the application-identifier entitlement (ldid)");
    if ((size_t)snprintf(ent, sizeof ent, "%s/ent.xml", work) >= sizeof ent) return fail(err, "work path too long");
    FILE *f = NULL;
    int fd = open(ent, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (fd >= 0 && !(f = fdopen(fd, "w"))) close(fd);
    if (!f) return fail(err, "can't write the entitlements file");
    /* id passed helper_ipa_bundle_id_ok and team helper_ipa_team_ok: nothing in them needs escaping. */
    fprintf(f, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
               "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n"
               "<plist version=\"1.0\">\n<dict>\n"
               "\t<key>application-identifier</key>\n\t<string>%s.%s</string>\n"
               "\t<key>com.apple.developer.team-identifier</key>\n\t<string>%s</string>\n"
               "</dict>\n</plist>\n", team, id, team);
    if (fclose(f)) return fail(err, "can't write the entitlements file");
    char sopt[PATH_MAX + 3];
    snprintf(sopt, sizeof sopt, "-S%s", ent);
    /* The whole .app, not just the binary: SpringBoard refuses to launch an app whose bundle has no
     * _CodeSignature/CodeResources ("No code signature found", checked on the 7), even when its binary is signed. */
    const char *sign[] = {ldid, "-M", sopt, app, NULL};
    fflush(stdout);
    rc = run_as(uid, gid, pkg, env, sign);
    if (rc) { *err = "ldid couldn't add the application-identifier entitlement"; return HELPER_EX_ADHOC; }
    return 1;
}

static int do_install(const char *prefix, const char *ipa, char *const env[], const char *work, const char **err) {
    /* 1. The caller's IPA: its directory is the real one (iOS's /var -> /private/var aside, no link on the way), the
     * file a plain one of the user who owns that directory. */
    char real[PATH_MAX];
    if (!realpath(HELPER_IPA_DIR, real) ||
        (strcmp(real, HELPER_IPA_DIR) && strcmp(real, "/private" HELPER_IPA_DIR)))
        return fail(err, "the IPA directory is missing or a link");
    int dir = open(real, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (dir < 0) return fail(err, "can't open the IPA directory");
    struct stat dst, st;
    int in = fstat(dir, &dst) ? -1 : openat(dir, strrchr(ipa, '/') + 1, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    close(dir);
    if (in < 0) { *err = "can't open the IPA (missing, or a link)"; return HELPER_EX_USAGE; }
    if (fstat(in, &st) || !S_ISREG(st.st_mode) || st.st_nlink != 1 || st.st_uid == 0 || st.st_uid != dst.st_uid ||
        st.st_size <= 0 || st.st_size > IPA_MAX_SIZE) {
        close(in);
        *err = "the IPA isn't a plain file of the app's own (one link, not root's, at most 8 GiB)";
        return HELPER_EX_USAGE;
    }
    uid_t uid = st.st_uid;
    gid_t gid = st.st_gid;

    progress(NULL, 5, "Copying the IPA");
    char copy[PATH_MAX], pkg[PATH_MAX];
    if ((size_t)snprintf(copy, sizeof copy, "%s/app.ipa", work) >= sizeof copy ||
        (size_t)snprintf(pkg, sizeof pkg, "%s/pkg", work) >= sizeof pkg)
        return fail(err, "work path too long");
    int out = open(copy, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (out < 0) { close(in); return fail(err, "can't create the IPA's copy"); }
    char buf[65536];
    ssize_t n;
    long long total = 0;
    while ((n = read(in, buf, sizeof buf)) > 0) {
        total += n;
        if (total > IPA_MAX_SIZE || write(out, buf, (size_t)n) != n) { n = -1; break; }
    }
    close(in);
    if (n < 0 || fsync(out) || close(out)) return fail(err, "can't copy the IPA");

    /* 2. Unpacked by the user, not root. */
    progress(NULL, 20, "Unpacking");
    if (mkdir(pkg, 0755) || chown(pkg, uid, gid)) return fail(err, "can't make the unpack directory");
    char unzip[PATH_MAX];
    if ((size_t)snprintf(unzip, sizeof unzip, "%s/usr/bin/unzip", prefix) >= sizeof unzip) return fail(err, "prefix too long");
    const char *uz[] = {unzip, "-qq", "-o", copy, "-d", pkg, NULL};
    int rc = run_as(uid, gid, pkg, env, uz);
    if (rc < 0 || rc == 126) return fail(err, "can't run unzip (the jailbreak's unzip package)");
    if (rc != 0 && rc != 1) { *err = "unzip couldn't unpack the IPA"; return HELPER_EX_USAGE; }
    char payload[PATH_MAX], app[PATH_MAX], id[HELPER_NAME_MAX + 1];
    if ((size_t)snprintf(payload, sizeof payload, "%s/Payload", pkg) >= sizeof payload) return fail(err, "work path too long");
    if (find_app(payload, app, sizeof app)) { *err = "not an IPA: no single Payload/<name>.app"; return HELPER_EX_USAGE; }
    if (read_plist(app, id, sizeof id)) { *err = "no usable CFBundleIdentifier in the app's Info.plist"; return HELPER_EX_USAGE; }

    /* 3. installd. */
    char why[512] = "";
    char ldid[PATH_MAX];
    if ((size_t)snprintf(ldid, sizeof ldid, "%s/usr/bin/ldid", prefix) >= sizeof ldid) return fail(err, "prefix too long");
    if (helper_ipa_appsync(prefix)) {
        /* B59: AppSync takes any signature but installd still wants application-identifier: fakesign the binary
         * when it lacks one and install the unpacked .app (there's no zip to pack it back); otherwise the IPA. */
        int signed_app = 0;
        if (!access(ldid, X_OK)) {
            rc = fakesign(ldid, uid, gid, pkg, work, app, id, env, err);
            if (rc > 1) return rc;
            signed_app = rc == 1;
        }
        progress(id, 50, "Installing (AppSync Unified)");
        if (install(signed_app ? app : copy, id, signed_app, why, sizeof why)) {
            fprintf(stderr, "ifizbox-helper: installd: %s\n", why);
            *err = "installd refused the app";
            return 1;
        }
    } else {
        if (access(ldid, X_OK)) {
            *err = "AppSync Unified isn't installed and there's no ldid to sign the app ad hoc: install AppSync "
                   "Unified or ldid, or sign the IPA for this iPhone first";
            return HELPER_EX_ADHOC;
        }
        progress(id, 40, "Signing ad hoc (ldid)");
        const char *ld[] = {ldid, "-s", app, NULL};
        rc = run_as(uid, gid, pkg, env, ld);
        if (rc) { *err = "ldid couldn't sign the app ad hoc"; return HELPER_EX_ADHOC; }
        rc = fakesign(ldid, uid, gid, pkg, work, app, id, env, err); /* B59 */
        if (rc > 1) return rc;
        progress(id, 60, "Installing (ad hoc signed)");
        if (install(app, id, 1, why, sizeof why)) {
            fprintf(stderr, "ifizbox-helper: installd: %s\n", why);
            *err = "installd refused the ad hoc signed app: this jailbreak can't install ad hoc apps without AppSync "
                   "Unified. Install AppSync Unified, or sign the IPA for this iPhone first";
            return HELPER_EX_ADHOC;
        }
    }
    progress(id, 100, "Installed");
    printf("Installed %s\n", id);
    return 0;
}

int helper_install_ipa(const char *prefix, const char *ipa, int fd3, char *const env[], const char **err) {
    status_fd = fd3;
    char work[PATH_MAX];
    if ((size_t)snprintf(work, sizeof work, "%s/ifizbox-ipa.XXXXXX", HELPER_IPA_WORK) >= sizeof work)
        return fail(err, "work path too long");
    if (!mkdtemp(work)) return fail(err, "can't make a work directory");
    chmod(work, 0755); /* installd reads the copy; nobody else may write here */
    int rc = do_install(prefix, ipa, env, work, err);
    remove_tree(work);
    return rc;
}

/* ---- I4: app-versions (ipa.h). Runs nothing; reads installd's containers so the app can show the real versions. */

#ifndef HELPER_PLIST_MAX
#define HELPER_PLIST_MAX IPA_PLIST_MAX
#endif

int helper_app_value_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > 255) return 0;
    for (const unsigned char *p = (const unsigned char *)s; *p; p++)
        if (*p < 0x20 || *p == 0x7f) return 0;
    return 1;
}

int helper_plist_string(const char *data, size_t len, const char *key, char *out, size_t size) {
    out[0] = 0;
#ifdef __APPLE__
    CFDataRef d = CFDataCreateWithBytesNoCopy(NULL, (const UInt8 *)data, (CFIndex)len, kCFAllocatorNull);
    CFPropertyListRef pl = d ? CFPropertyListCreateWithData(NULL, d, kCFPropertyListImmutable, NULL, NULL) : NULL;
    if (d) CFRelease(d);
    CFStringRef k = CFStringCreateWithCString(NULL, key, kCFStringEncodingUTF8);
    int ok = -1;
    if (pl && k && CFGetTypeID(pl) == CFDictionaryGetTypeID()) {
        CFTypeRef v = CFDictionaryGetValue((CFDictionaryRef)pl, k);
        if (v && CFGetTypeID(v) == CFStringGetTypeID() &&
            CFStringGetCString((CFStringRef)v, out, (CFIndex)size, kCFStringEncodingUTF8))
            ok = 0;
    }
    if (k) CFRelease(k);
    if (pl) CFRelease(pl);
    if (ok) { out[0] = 0; return -1; }
    return 0;
#else
    char pat[300];
    int pn = snprintf(pat, sizeof pat, "<key>%s</key>", key);
    if (pn < 0 || (size_t)pn >= sizeof pat) return -1;
    const char *end = data + len, *k = NULL;
    for (const char *p = data; p + pn <= end; p++)
        if (!memcmp(p, pat, (size_t)pn)) { k = p + pn; break; }
    if (!k) return -1;
    while (k < end && (*k == ' ' || *k == '\t' || *k == '\n' || *k == '\r')) k++;
    if (end - k < 8 || memcmp(k, "<string>", 8)) return -1;
    k += 8;
    const char *e = k;
    while (e < end && *e != '<') e++;
    if (e == end || (size_t)(e - k) >= size) return -1;
    memcpy(out, k, (size_t)(e - k));
    out[e - k] = 0;
    return 0;
#endif
}

/* A regular file (not a link) of 1..HELPER_PLIST_MAX bytes, read whole into a malloc'd *buf; 0 or -1. */
static int read_small(const char *path, char **buf, size_t *len) {
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (fd < 0) return -1;
    struct stat st;
    int rc = -1;
    *buf = NULL;
    if (!fstat(fd, &st) && S_ISREG(st.st_mode) && st.st_size > 0 && st.st_size <= HELPER_PLIST_MAX &&
        (*buf = malloc((size_t)st.st_size))) {
        size_t got = 0;
        ssize_t n;
        while (got < (size_t)st.st_size && (n = read(fd, *buf + got, (size_t)st.st_size - got)) > 0) got += (size_t)n;
        if (got == (size_t)st.st_size) { *len = got; rc = 0; }
        else { free(*buf); *buf = NULL; }
    }
    close(fd);
    return rc;
}

/* key's value from a plist's bytes into out, or "" when it's missing or not helper_app_value_ok. */
static void plist_value(const char *data, size_t len, const char *key, char *out, size_t size) {
    if (!data || helper_plist_string(data, len, key, out, size) || !helper_app_value_ok(out)) out[0] = 0;
}

int helper_app_versions(const char *dir, FILE *out, const char **err) {
    DIR *d = opendir(dir);
    if (!d) {
        if (errno == ENOENT) return 0;
        *err = "can't read the app containers folder";
        return -1;
    }
    int count = 0;
    struct dirent *de;
    while ((de = readdir(d)) && count < HELPER_APPS_MAX) {
        if (de->d_name[0] == '.') continue;
        char box[PATH_MAX], app[PATH_MAX], p[PATH_MAX];
        struct stat st;
        if ((size_t)snprintf(box, sizeof box, "%s/%s", dir, de->d_name) >= sizeof box) continue;
        if (lstat(box, &st) || !S_ISDIR(st.st_mode)) continue;
        if (find_app(box, app, sizeof app)) continue;
        if ((size_t)snprintf(p, sizeof p, "%s/Info.plist", app) >= sizeof p) continue;
        char *info = NULL, *meta = NULL;
        size_t ilen = 0, mlen = 0;
        if (read_small(p, &info, &ilen)) continue;
        char id[HELPER_NAME_MAX + 1], shortv[256], build[256], store[256];
        if (helper_plist_string(info, ilen, "CFBundleIdentifier", id, sizeof id) || !helper_ipa_bundle_id_ok(id)) {
            free(info);
            continue;
        }
        plist_value(info, ilen, "CFBundleShortVersionString", shortv, sizeof shortv);
        plist_value(info, ilen, "CFBundleVersion", build, sizeof build);
        free(info);
        store[0] = 0;
        if ((size_t)snprintf(p, sizeof p, "%s/iTunesMetadata.plist", box) < sizeof p && !read_small(p, &meta, &mlen)) {
            plist_value(meta, mlen, "bundleShortVersionString", store, sizeof store);
            free(meta);
        }
        fprintf(out, "%s\t%s\t%s\t%s\n", id, shortv, build, store);
        count++;
    }
    closedir(d);
    return count;
}

/* ---- B46: uninstall-app (ipa.h). Installed: Delete in the jailbreak app takes the app off the phone. */

int helper_app_find(const char *dir, const char *id, char *box, size_t size, const char **err) {
    DIR *d = opendir(dir);
    if (!d) {
        if (errno == ENOENT) return 1;
        *err = "can't read the app containers folder";
        return -1;
    }
    int seen = 0, rc = 1;
    struct dirent *de;
    while (rc && (de = readdir(d)) && seen < HELPER_APPS_MAX) {
        if (de->d_name[0] == '.') continue;
        char b[PATH_MAX], app[PATH_MAX], p[PATH_MAX];
        struct stat st;
        if ((size_t)snprintf(b, sizeof b, "%s/%s", dir, de->d_name) >= sizeof b) continue;
        if (lstat(b, &st) || !S_ISDIR(st.st_mode)) continue;
        if (find_app(b, app, sizeof app)) continue;
        seen++;
        if ((size_t)snprintf(p, sizeof p, "%s/Info.plist", app) >= sizeof p) continue;
        char *info = NULL;
        size_t ilen = 0;
        if (read_small(p, &info, &ilen)) continue;
        char got[HELPER_NAME_MAX + 1];
        if (!helper_plist_string(info, ilen, "CFBundleIdentifier", got, sizeof got) && !strcmp(got, id) &&
            (size_t)snprintf(box, size, "%s", b) < size)
            rc = 0;
        free(info);
    }
    closedir(d);
    return rc;
}

/* installd's uninstall. 0, or -1 with the reason in why. */
static int uninstall(const char *bundle, char *why, size_t size) {
#ifdef __APPLE__
    void *pool = objc_autoreleasePoolPush();
    int rc = -1;
    dlopen("/System/Library/Frameworks/MobileCoreServices.framework/MobileCoreServices", RTLD_NOW);
    Class ws = objc_getClass("LSApplicationWorkspace");
    if (!ws) {
        snprintf(why, size, "LSApplicationWorkspace isn't there");
    } else {
        id w = ((id(*)(Class, SEL))objc_msgSend)(ws, sel_registerName("defaultWorkspace"));
        CFStringRef cid = CFStringCreateWithCString(NULL, bundle, kCFStringEncodingUTF8);
        BOOL ok = ((BOOL(*)(id, SEL, id, id))objc_msgSend)(w, sel_registerName("uninstallApplication:withOptions:"),
                                                           (id)cid, nil);
        if (ok) rc = 0;
        else snprintf(why, size, "installd didn't uninstall %s", bundle);
        CFRelease(cid);
    }
    objc_autoreleasePoolPop(pool);
    return rc;
#else
    /* The tests' stand-in for installd, as install()'s. */
    printf("uninstall %s\n", bundle);
    size_t n = strlen(bundle);
    if (n >= 8 && !strcmp(bundle + n - 8, ".refused")) { snprintf(why, size, "test installd refused it"); return -1; }
    return 0;
#endif
}

int helper_uninstall_app(const char *dir, const char *id, int fd3, const char **err) {
    static char why[512];
    status_fd = fd3;
    if (!helper_ipa_bundle_id_ok(id)) { *err = "bad bundle id"; return HELPER_EX_USAGE; }
    char box[PATH_MAX];
    int found = helper_app_find(dir, id, box, sizeof box, err);
    if (found < 0) return HELPER_EX_IOERR;
    if (found) { *err = "not an app installed in the app containers (system and jailbreak apps aren't removed here)"; return HELPER_EX_USAGE; }
    progress(id, 10, "Removing");
    fflush(stdout);
    if (uninstall(id, why, sizeof why)) { *err = why; return 1; }
    progress(id, 100, "Removed");
    printf("Uninstalled %s\n", id);
    return 0;
}
