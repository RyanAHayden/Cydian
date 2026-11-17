/* cydian-helper's checks: see policy.h. SPDX-License-Identifier: GPL-3.0-or-later */
#include "policy.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

int helper_name_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 2 || n > HELPER_NAME_MAX) return 0;
    if (!((s[0] >= 'a' && s[0] <= 'z') || (s[0] >= '0' && s[0] <= '9'))) return 0; /* never an option */
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-')) return 0;
    }
    return 1;
}

int helper_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *p,
                const char **err) {
    static char status_apt[64], status_dpkg[16];
    memset(p, 0, sizeof *p);
    if (argc < 1) { *err = "no verb (" HELPER_VERBS ")"; return -1; }
    const char *verb = argv[0];
    int wants_packages;
    if (!strcmp(verb, "update")) { p->verb = HV_UPDATE; wants_packages = 0; }
    else if (!strcmp(verb, "install")) { p->verb = HV_INSTALL; wants_packages = 1; }
    else if (!strcmp(verb, "remove")) { p->verb = HV_REMOVE; wants_packages = 1; }
    else if (!strcmp(verb, "upgrade")) { p->verb = HV_UPGRADE; wants_packages = 0; }
    else if (!strcmp(verb, "configure")) { p->verb = HV_CONFIGURE; wants_packages = 0; }
    else if (!strcmp(verb, "hold")) { p->verb = HV_HOLD; wants_packages = 1; }
    else if (!strcmp(verb, "unhold")) { p->verb = HV_UNHOLD; wants_packages = 1; }
    else if (!strcmp(verb, "showhold")) { p->verb = HV_SHOWHOLD; wants_packages = 0; }
    else { *err = "unknown verb (" HELPER_VERBS ")"; return -1; }

    int n = argc - 1;
    if (!wants_packages && n) { *err = "this verb takes no arguments"; return -1; }
    if (wants_packages && n < 1) { *err = "no package names"; return -1; }
    if (n > HELPER_MAX_PACKAGES) { *err = "too many package names"; return -1; }
    for (int i = 1; i < argc; i++)
        if (!helper_name_ok(argv[i])) { *err = "bad package name (allowed: [a-z0-9][a-z0-9.+-]+)"; return -1; }

    int mark = p->verb == HV_HOLD || p->verb == HV_UNHOLD || p->verb == HV_SHOWHOLD;
    const char *tool = p->verb == HV_CONFIGURE ? "dpkg" : mark ? "apt-mark" : "apt-get";
    if ((size_t)snprintf(p->path, sizeof p->path, "%s/usr/bin/%s", prefix, tool) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }

    int k = 0;
    const char **a = p->argv;
    a[k++] = tool;
    if (p->verb == HV_CONFIGURE) {
        /* stdin is /dev/null: keep the old conffile unless the package's default says otherwise, never ask. */
        a[k++] = "--force-confdef";
        a[k++] = "--force-confold";
        if (status_fd >= 0) {
            snprintf(status_dpkg, sizeof status_dpkg, "%d", status_fd);
            a[k++] = "--status-fd";
            a[k++] = status_dpkg;
        }
        a[k++] = "--configure";
        a[k++] = "-a";
    } else if (mark) {
        /* apt-mark has no progress to report: no status fd. Only a name dpkg knows gets here (helper_first_unknown),
         * so apt-mark never reads one as a pattern. */
        a[k++] = verb; /* hold, unhold or showhold: the literals checked above */
        p->packages = (const char *const *)&a[k];
        p->npackages = n;
        for (int i = 1; i < argc; i++) a[k++] = argv[i];
    } else {
        if (p->verb != HV_UPDATE) {
            a[k++] = "-y";
            a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confdef";
            a[k++] = "-o"; a[k++] = "Dpkg::Options::=--force-confold";
        }
        if (status_fd >= 0) {
            snprintf(status_apt, sizeof status_apt, "APT::Status-Fd=%d", status_fd);
            a[k++] = "-o";
            a[k++] = status_apt;
        }
        a[k++] = verb; /* one of the literals checked above */
        p->packages = (const char *const *)&a[k];
        p->npackages = n;
        for (int i = 1; i < argc; i++) a[k++] = argv[i];
    }
    a[k] = NULL;
    p->argc = k;
    return 0;
}

/* Mark in found[] every package named by a "Package: <name>" line of path. A missing file is no error. */
static void scan(const char *path, const struct helper_plan *p, char *found) {
    FILE *f = fopen(path, "r");
    if (!f) return;
    char *line = NULL;
    size_t cap = 0;
    ssize_t len;
    while ((len = getline(&line, &cap, f)) >= 0) {
        if (strncmp(line, "Package:", 8)) continue;
        char *s = line + 8, *e = line + len;
        while (s < e && (*s == ' ' || *s == '\t')) s++;
        while (e > s && (e[-1] == '\n' || e[-1] == '\r' || e[-1] == ' ' || e[-1] == '\t')) e--;
        size_t n = (size_t)(e - s);
        for (int i = 0; i < p->npackages; i++)
            if (!found[i] && strlen(p->packages[i]) == n && !memcmp(p->packages[i], s, n)) found[i] = 1;
    }
    free(line);
    fclose(f);
}

static int first_missing(const struct helper_plan *p, const char *found) {
    for (int i = 0; i < p->npackages; i++)
        if (!found[i]) return i;
    return -1;
}

int helper_first_unknown(const char *prefix, const struct helper_plan *p) {
    if (p->verb != HV_INSTALL && p->verb != HV_REMOVE && p->verb != HV_HOLD && p->verb != HV_UNHOLD) return -1;
    char found[HELPER_MAX_PACKAGES] = {0};
    char path[PATH_MAX];
    snprintf(path, sizeof path, "%s/var/lib/dpkg/status", prefix);
    scan(path, p, found);
    if (p->verb != HV_INSTALL || first_missing(p, found) < 0) return first_missing(p, found);

    snprintf(path, sizeof path, "%s/var/lib/apt/lists", prefix);
    DIR *d = opendir(path);
    if (d) {
        struct dirent *de;
        while ((de = readdir(d)) && first_missing(p, found) >= 0) {
            size_t n = strlen(de->d_name);
            if (n < 9 || strcmp(de->d_name + n - 9, "_Packages")) continue;
            char file[PATH_MAX];
            if ((size_t)snprintf(file, sizeof file, "%s/%s", path, de->d_name) >= sizeof file) continue;
            scan(file, p, found);
        }
        closedir(d);
    }
    return first_missing(p, found);
}

int helper_caller_ok(uid_t uid, uid_t euid, uid_t root_uid, const char *parent_exe, const char *expected_exe,
                     const char **err) {
    if (uid != root_uid || euid != root_uid) {
        *err = "not root: Cydian must spawn the helper with the root persona";
        return -1;
    }
    struct stat a, b;
    if (!parent_exe || stat(parent_exe, &a) || stat(expected_exe, &b)) {
        *err = "can't identify the calling process";
        return -1;
    }
    if (a.st_dev != b.st_dev || a.st_ino != b.st_ino) {
        *err = "the calling process isn't Cydian";
        return -1;
    }
    return 0;
}
