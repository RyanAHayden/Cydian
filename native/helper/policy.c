/* cydian-helper's checks: see policy.h. SPDX-License-Identifier: GPL-3.0-or-later */
#include "policy.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

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

static int alnum(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'); }

/* 1 if the "/"-separated path s (length n) has a "." or ".." segment ("" segments are fine: "a//b"). */
static int dot_segment(const char *s, size_t n) {
    size_t i = 0;
    while (i <= n) {
        size_t j = i;
        while (j < n && s[j] != '/') j++;
        size_t len = j - i;
        if ((len == 1 && s[i] == '.') || (len == 2 && s[i] == '.' && s[i + 1] == '.')) return 1;
        i = j + 1;
    }
    return 0;
}

int helper_uri_ok(const char *s) {
    size_t n = strlen(s);
    if (n > HELPER_URI_MAX) return 0;
    const char *p;
    if (!strncmp(s, "https://", 8)) p = s + 8;
    else if (!strncmp(s, "http://", 7)) p = s + 7;
    else return 0;
    const char *host = p;
    while (alnum(*p) || *p == '.' || *p == '-') p++;
    if (p == host || *host == '.' || *host == '-') return 0;
    if (*p == ':') {
        const char *port = ++p;
        while (*p >= '0' && *p <= '9') p++;
        if (p == port || p - port > 5) return 0;
    }
    if (*p != '/' || s[n - 1] != '/') return 0;
    for (const char *q = p; *q; q++)
        if (!(alnum(*q) || strchr("._~%+/:=,-", *q))) return 0;
    const char *last = s + n - 1; /* the final "/"; p is the first */
    return last == p || !dot_segment(p + 1, (size_t)(last - (p + 1)));
}

int helper_suite_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > HELPER_SUITE_MAX || s[0] == '-' || s[0] == '/') return 0;
    for (size_t i = 0; i < n; i++)
        if (!(alnum(s[i]) || strchr("._+/-", s[i]))) return 0;
    if (!strcmp(s, "./")) return 1; /* the flat repo's own directory */
    return !dot_segment(s, s[n - 1] == '/' ? n - 1 : n);
}

int helper_component_ok(const char *s) {
    size_t n = strlen(s);
    if (n < 1 || n > HELPER_COMPONENT_MAX || !alnum(s[0]) || s[n - 1] == '/') return 0;
    for (size_t i = 0; i < n; i++)
        if (!(alnum(s[i]) || strchr("._+/-", s[i]))) return 0;
    return !dot_segment(s, n);
}

/* addsource <uri> <suite> [component...] | removesource <uri> <suite>: checked here, done by helper_sources_apply. */
static int source_plan(int argc, char *const argv[], const char *prefix, struct helper_plan *p, const char **err) {
    int add = p->verb == HV_ADDSOURCE;
    if (argc < 3) { *err = "needs a URI and a suite"; return -1; }
    if (!helper_uri_ok(argv[1])) {
        *err = "bad URI (http(s)://host[:port]/path/, ending in /, no user, spaces or . segments)"; return -1;
    }
    if (!helper_suite_ok(argv[2])) { *err = "bad suite"; return -1; }
    int flat = argv[2][strlen(argv[2]) - 1] == '/', ncomp = argc - 3;
    if (!add && ncomp) { *err = "removesource takes a URI and a suite only"; return -1; }
    if (add && flat && ncomp) { *err = "a flat suite (ending in /) takes no components"; return -1; }
    if (add && !flat && !ncomp) { *err = "a suite that isn't flat needs components"; return -1; }
    if (ncomp > HELPER_MAX_COMPONENTS) { *err = "too many components"; return -1; }
    for (int i = 3; i < argc; i++)
        if (!helper_component_ok(argv[i])) { *err = "bad component"; return -1; }
    if ((size_t)snprintf(p->path, sizeof p->path, "%s%s", prefix, HELPER_SOURCES_FILE) >= sizeof p->path) {
        *err = "prefix too long"; return -1;
    }
    for (int i = 0; i < argc; i++) p->argv[i] = argv[i];
    p->argv[argc] = NULL;
    p->argc = argc;
    return 0;
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
    else if (!strcmp(verb, "addsource")) { p->verb = HV_ADDSOURCE; return source_plan(argc, argv, prefix, p, err); }
    else if (!strcmp(verb, "removesource")) { p->verb = HV_REMOVESOURCE; return source_plan(argc, argv, prefix, p, err); }
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

/* --- F33: cydian.sources */

#define SOURCES_MAX (1 << 20) /* a bigger cydian.sources isn't ours: refuse rather than rewrite it */

struct buf { char *s; size_t n, cap; };

static int put(struct buf *b, const char *s, size_t n) {
    if (b->n + n + 1 > b->cap) {
        size_t cap = b->cap ? b->cap : 1024;
        while (b->n + n + 1 > cap) cap *= 2;
        char *t = realloc(b->s, cap);
        if (!t) return -1;
        b->s = t;
        b->cap = cap;
    }
    memcpy(b->s + b->n, s, n);
    b->n += n;
    b->s[b->n] = 0;
    return 0;
}
static int puts_(struct buf *b, const char *s) { return put(b, s, strlen(s)); }

/* The value of field `name` (case-insensitive) in the stanza st[0..n), continuation lines folded in with one space,
 * comment lines skipped, whitespace trimmed, into out (size cap); "" when the field isn't there. */
static void field(const char *st, size_t n, const char *name, char *out, size_t cap) {
    size_t used = 0, nl = strlen(name);
    int in = 0;
    out[0] = 0;
    for (size_t i = 0; i < n;) {
        size_t j = i;
        while (j < n && st[j] != '\n') j++;
        const char *l = st + i, *v;
        size_t len = j - i, vl;
        i = j + 1;
        if (len && l[0] == '#') continue;
        if (len && (l[0] == ' ' || l[0] == '\t')) {
            if (!in) continue;
            v = l; vl = len;
        } else {
            in = len > nl && l[nl] == ':' && !strncasecmp(l, name, nl);
            if (!in) continue;
            v = l + nl + 1; vl = len - nl - 1;
        }
        while (vl && (*v == ' ' || *v == '\t' || *v == '\r')) { v++; vl--; }
        while (vl && (v[vl - 1] == ' ' || v[vl - 1] == '\t' || v[vl - 1] == '\r')) vl--;
        if (!vl) continue;
        if (used && used + 1 < cap) out[used++] = ' ';
        if (used + vl >= cap) vl = cap - 1 - used;
        memcpy(out + used, v, vl);
        used += vl;
        out[used] = 0;
    }
}

/* 1 if the stanza names exactly this one URI and this one suite. A hand-written stanza with more URIs or suites
 * is left as it is. */
static int names(const char *st, size_t n, const char *uri, const char *suite) {
    char u[HELPER_URI_MAX + 64], s[HELPER_SUITE_MAX + 64];
    field(st, n, "URIs", u, sizeof u);
    field(st, n, "Suites", s, sizeof s);
    return !strcmp(u, uri) && !strcmp(s, suite);
}

/* The whole of path into b (b->s is never NULL after a 0 return); a missing file is empty. */
static int read_all(const char *path, struct buf *b, const char **err) {
    if (puts_(b, "")) { *err = "out of memory"; return -1; }
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) {
        if (errno == ENOENT) return 0;
        *err = "can't read cydian.sources";
        return -1;
    }
    struct stat st;
    if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_size > SOURCES_MAX) {
        close(fd);
        *err = "cydian.sources isn't a regular file of at most 1 MiB";
        return -1;
    }
    char chunk[8192];
    ssize_t r;
    while ((r = read(fd, chunk, sizeof chunk)) != 0) {
        if (r < 0 && errno == EINTR) continue;
        if (r < 0 || b->n + (size_t)r > SOURCES_MAX || put(b, chunk, (size_t)r)) {
            close(fd);
            *err = "can't read cydian.sources";
            return -1;
        }
    }
    close(fd);
    return 0;
}

static int write_all(int fd, const char *s, size_t n) {
    while (n) {
        ssize_t w = write(fd, s, n);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) return -1;
        s += w;
        n -= (size_t)w;
    }
    return 0;
}

/* Write text to path through a temp file beside it and rename(2); empty text removes the file. */
static int replace_file(const char *path, const char *text, size_t n, const char **err) {
    char dir[PATH_MAX], tmp[PATH_MAX];
    snprintf(dir, sizeof dir, "%s", path);
    char *slash = strrchr(dir, '/');
    if (!slash) { *err = "bad sources path"; return -1; }
    *slash = 0;
    if (!n) {
        if (unlink(path) && errno != ENOENT) { *err = "can't remove cydian.sources"; return -1; }
        return 0;
    }
    if ((size_t)snprintf(tmp, sizeof tmp, "%s/.cydian.sources.XXXXXX", dir) >= sizeof tmp) {
        *err = "prefix too long"; return -1;
    }
    /* The name starts with "." and has no .sources/.list suffix, so apt ignores it if we die before the rename. */
    int fd = mkstemp(tmp);
    if (fd < 0) { *err = "can't create a temp file in sources.list.d"; return -1; }
    if (fchmod(fd, 0644) || write_all(fd, text, n) || fsync(fd)) {
        close(fd);
        unlink(tmp);
        *err = "can't write cydian.sources";
        return -1;
    }
    if (close(fd) || rename(tmp, path)) {
        unlink(tmp);
        *err = "can't replace cydian.sources";
        return -1;
    }
    return 0;
}

int helper_sources_apply(const struct helper_plan *p, int *changed, const char **err) {
    *changed = 0;
    if (p->verb != HV_ADDSOURCE && p->verb != HV_REMOVESOURCE) { *err = "not a source verb"; return -1; }
    const char *uri = p->argv[1], *suite = p->argv[2];
    struct buf old = {0}, out = {0}, mine = {0};
    int rc = -1, lock = -1;

    /* Two helpers at once (two adds from the app) would each read the old file and one add would be lost: hold
     * an exclusive flock on sources.list.d (made if missing; its parent etc/apt must be there) for the edit. */
    char dir[PATH_MAX];
    snprintf(dir, sizeof dir, "%s", p->path);
    char *slash = strrchr(dir, '/');
    if (!slash) { *err = "bad sources path"; return -1; }
    *slash = 0;
    if (mkdir(dir, 0755) && errno != EEXIST) { *err = "can't create sources.list.d"; return -1; }
    lock = open(dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (lock < 0 || flock(lock, LOCK_EX)) {
        if (lock >= 0) close(lock);
        *err = "can't lock sources.list.d";
        return -1;
    }
    if (read_all(p->path, &old, err) || puts_(&out, "")) goto done;

    if (p->verb == HV_ADDSOURCE) {
        int bad = puts_(&mine, "Types: deb\nURIs: ") || puts_(&mine, uri) || puts_(&mine, "\nSuites: ") ||
                  puts_(&mine, suite);
        if (p->argc > 3) {
            bad |= puts_(&mine, "\nComponents:");
            for (int i = 3; i < p->argc; i++) bad |= puts_(&mine, " ") || puts_(&mine, p->argv[i]);
        }
        if (bad) { *err = "out of memory"; goto done; }
    }

    /* Stanzas are separated by blank lines. Each is copied as it is (one blank line between them), except those
     * naming this source: the first becomes ours (addsource), the rest go. Not there: ours goes at the end. */
    int placed = p->verb == HV_REMOVESOURCE;
    size_t i = 0, n = old.n;
    while (i < n) {
        size_t start = i, end = i;
        while (i < n) {
            size_t j = i;
            while (j < n && old.s[j] != '\n') j++;
            int blank = 1;
            for (size_t k = i; k < j; k++)
                if (old.s[k] != ' ' && old.s[k] != '\t' && old.s[k] != '\r') blank = 0;
            i = j < n ? j + 1 : n;
            if (!blank) { end = j; continue; }
            if (end > start) break;
            start = end = i;
        }
        if (end <= start) continue;
        const char *keep = old.s + start;
        size_t keeplen = end - start;
        if (names(keep, keeplen, uri, suite)) {
            if (placed) continue;
            placed = 1;
            keep = mine.s;
            keeplen = mine.n;
        }
        if ((out.n && put(&out, "\n", 1)) || put(&out, keep, keeplen) || put(&out, "\n", 1)) {
            *err = "out of memory"; goto done;
        }
    }
    if (!placed && ((out.n && put(&out, "\n", 1)) || put(&out, mine.s, mine.n) || put(&out, "\n", 1))) {
        *err = "out of memory"; goto done;
    }

    rc = 0;
    if (out.n == old.n && !memcmp(out.s, old.s, out.n)) goto done;
    if (replace_file(p->path, out.s, out.n, err)) { rc = -1; goto done; }
    *changed = 1;
done:
    close(lock);
    free(old.s);
    free(out.s);
    free(mine.s);
    return rc;
}
