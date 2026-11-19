/* F57: ifizbox-helper install-paid <path> <id> <version>: a paid package's .deb that the app downloaded from the
 * vendor's one-time URL (Paid.swift paid.install).
 *
 *   1. Open the .deb without following links: a regular file, one link, owned by the user who owns its directory
 *      (mobile), never root, at most 1 GiB. Copied into a fresh root-owned directory under HELPER_PAID_WORK, so
 *      nothing the caller does afterwards changes what gets installed (as install-ipa does, ipa.c).
 *   2. dpkg-deb reads the copy's control: Package must be the id asked and Version the version (rollback's check).
 *   3. apt-get install <the copy>, as rollback does: apt installs the file and pulls in its dependencies.
 * N9's simulate-deb and install-deb (helper_local_deb) take the same road from HELPER_DEB_DIR, without step 2.
 * Installs (not simulate-deb) also put the copy in apt's archive cache for the run (seed_archive), so apt never
 * downloads a source's copy of the same version and hash instead of the file it was given.
 * SPDX-License-Identifier: GPL-3.0-or-later */
#include "paid.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

static void remove_work(const char *work, const char *copy) {
    unlink(copy);
    rmdir(work);
}

static int copy_in(const char *from, const char *src, const char *copy, const char **err) {
    char real[PATH_MAX], priv[PATH_MAX];
    snprintf(priv, sizeof priv, "/private%s", from);
    if (!realpath(from, real) || (strcmp(real, from) && strcmp(real, priv))) {
        *err = "the download directory is missing or a link";
        return HELPER_EX_IOERR;
    }
    int dir = open(real, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (dir < 0) { *err = "can't open the download directory"; return HELPER_EX_IOERR; }
    struct stat dst, st;
    int in = fstat(dir, &dst) ? -1 : openat(dir, strrchr(src, '/') + 1, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    close(dir);
    if (in < 0) { *err = "can't open the .deb (missing, or a link)"; return HELPER_EX_USAGE; }
    if (fstat(in, &st) || !S_ISREG(st.st_mode) || st.st_nlink != 1 || st.st_uid == 0 || st.st_uid != dst.st_uid ||
        st.st_size <= 0 || st.st_size > HELPER_PAID_MAX_SIZE) {
        close(in);
        *err = "the .deb isn't a plain file of the app's own (one link, not root's, at most 1 GiB)";
        return HELPER_EX_USAGE;
    }
    int out = open(copy, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (out < 0) { close(in); *err = "can't create the .deb's copy"; return HELPER_EX_IOERR; }
    char buf[65536];
    ssize_t n;
    long long total = 0;
    while ((n = read(in, buf, sizeof buf)) != 0) {
        if (n < 0) { if (errno == EINTR) continue; break; }
        total += n;
        if (total > HELPER_PAID_MAX_SIZE || write(out, buf, (size_t)n) != n) { n = -1; break; }
    }
    close(in);
    if (n < 0 || fsync(out) || close(out)) { *err = "can't copy the .deb"; return HELPER_EX_IOERR; }
    return 0;
}

/* B70: apt merges a local .deb with a source's version when version and hash match, and may then fetch the source's
 * copy instead of using the file it was given (a second download, and a failed row when the source refuses apt).
 * Before apt-get installs the copy, put it in apt's archive cache (<prefix>/var/cache/apt/archives) under the name
 * apt gives that version (pkgAcqArchive: QuoteString(Package,"_:")_QuoteString(Version,"_:")_QuoteString(Arch,"_:.")
 * .deb): apt checks a file there against the source's hashes and installs it without a download. Best effort: when
 * dpkg-deb can't read the control, the fields aren't plain, the cache is missing or the name is taken (apt's own
 * file, checked by apt), nothing is placed and apt does what it did before. Returns 1 when `cached` was created
 * (remove it after the run), else 0. */
static int read_fields(const char *prefix, const char *deb, char *buf, size_t size) {
    char tool[PATH_MAX], path_env[PATH_MAX + 16];
    if ((size_t)snprintf(tool, sizeof tool, "%s/usr/bin/dpkg-deb", prefix) >= sizeof tool) return -1;
    snprintf(path_env, sizeof path_env, "PATH=%s/usr/bin:/usr/bin:/bin", prefix);
    int fds[2];
    if (pipe(fds)) return -1;
    pid_t pid = fork();
    if (pid < 0) { close(fds[0]); close(fds[1]); return -1; }
    if (pid == 0) {
        int null = open("/dev/null", O_RDWR);
        if (null < 0 || dup2(null, 0) < 0 || dup2(null, 2) < 0 || dup2(fds[1], 1) < 0) _exit(126);
        char *const argv[] = {"dpkg-deb", "-f", (char *)deb, "Package", "Version", "Architecture", NULL};
        char *const env[] = {path_env, "LANG=C", NULL};
        execve(tool, argv, env);
        _exit(126);
    }
    close(fds[1]);
    size_t used = 0;
    for (;;) {
        ssize_t r = read(fds[0], buf + used, size - 1 - used);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) break;
        used += (size_t)r;
        if (used == size - 1) break;
    }
    buf[used] = 0;
    close(fds[0]);
    int st;
    while (waitpid(pid, &st, 0) < 0)
        if (errno != EINTR) return -1;
    return WIFEXITED(st) && !WEXITSTATUS(st) ? 0 : -1;
}

/* The value of "<name>: value" in dpkg-deb -f's lines, once and on one line, into out; 0 when found. */
static int field(const char *text, const char *name, char *out, size_t size) {
    size_t nl = strlen(name);
    int found = 0;
    for (const char *l = text; *l;) {
        const char *e = strchr(l, '\n');
        size_t len = e ? (size_t)(e - l) : strlen(l);
        if (len > nl + 1 && !strncmp(l, name, nl) && l[nl] == ':') {
            const char *v = l + nl + 1;
            while (*v == ' ') v++;
            size_t vl = len - (size_t)(v - l);
            if (found || !vl || vl >= size) return -1;
            memcpy(out, v, vl);
            out[vl] = 0;
            found = 1;
        }
        if (!e) break;
        l = e + 1;
    }
    return found ? 0 : -1;
}

/* apt's QuoteString: bytes in `bad`, '%', spaces, controls and non-ASCII become %xx (lowercase hex). */
static int quote(char *out, size_t size, const char *s, const char *bad) {
    size_t k = 0;
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        int n = strchr(bad, c) || c == '%' || c <= 0x20 || c >= 0x7f
                    ? snprintf(out + k, size - k, "%%%02x", c) : snprintf(out + k, size - k, "%c", c);
        if (n < 0 || (size_t)n >= size - k) return -1;
        k += (size_t)n;
    }
    return 0;
}

static int arch_ok(const char *s) {
    if (!*s) return 0;
    for (; *s; s++)
        if (!((*s >= 'a' && *s <= 'z') || (*s >= '0' && *s <= '9') || *s == '-')) return 0;
    return 1;
}

static int seed_archive(const char *prefix, const char *copy, char *cached, size_t size) {
    char text[4096], pkg[256], ver[256], arch[64], qpkg[800], qver[800], qarch[200];
    if (read_fields(prefix, copy, text, sizeof text) || field(text, "Package", pkg, sizeof pkg) ||
        field(text, "Version", ver, sizeof ver) || field(text, "Architecture", arch, sizeof arch))
        return 0;
    if (!helper_name_ok(pkg) || !helper_version_ok(ver) || !arch_ok(arch)) return 0;
    if (quote(qpkg, sizeof qpkg, pkg, "_:") || quote(qver, sizeof qver, ver, "_:") ||
        quote(qarch, sizeof qarch, arch, "_:."))
        return 0;
    char dir[PATH_MAX], real[PATH_MAX];
    if ((size_t)snprintf(dir, sizeof dir, "%s/var/cache/apt/archives", prefix) >= sizeof dir || !realpath(dir, real))
        return 0;
    if ((size_t)snprintf(cached, size, "%s/%s_%s_%s.deb", real, qpkg, qver, qarch) >= size) return 0;
    int in = open(copy, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (in < 0) return 0;
    int out = open(cached, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (out < 0) { close(in); return 0; } /* taken: apt's own file, which apt checks against the hashes itself */
    char buf[65536];
    ssize_t n;
    while ((n = read(in, buf, sizeof buf)) != 0) {
        if (n < 0) { if (errno == EINTR) continue; break; }
        if (write(out, buf, (size_t)n) != n) { n = -1; break; }
    }
    close(in);
    if (close(out) || n < 0) { unlink(cached); return 0; }
    return 1;
}

/* Run plan's apt-get: by `run` (F239: install-deb-ask, main.c's answer relay) or a plain fork and exec. */
static int run_apt(struct helper_plan *plan, char *const env[], helper_deb_runner run, int answers, const char **err) {
    *err = NULL;
    if (run) return run(plan, env, answers);
    pid_t pid = fork();
    if (pid < 0) { *err = "can't run apt-get (fork)"; return HELPER_EX_EXEC; }
    if (pid == 0) {
        execve(plan->path, (char *const *)plan->argv, env);
        fprintf(stderr, "ifizbox-helper: %s: %s\n", plan->path, strerror(errno));
        _exit(HELPER_EX_EXEC);
    }
    int st;
    while (waitpid(pid, &st, 0) < 0)
        if (errno != EINTR) { *err = "can't wait for apt-get"; return HELPER_EX_EXEC; }
    return WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
}

/* Copy plan->deb (in `from`) into a fresh root-owned <HELPER_PAID_WORK>/<tag>.XXXXXX/<tag>.deb, check it when `id` is
 * set (install-paid), run plan's apt-get on the copy, remove the directory. */
static int run_on_copy(const char *prefix, struct helper_plan *plan, char *const env[], const char *from, const char *tag,
                       const char *id, const char *version, helper_deb_runner run, int answers, const char **err) {
    char work[PATH_MAX], copy[PATH_MAX], src[PATH_MAX];
    snprintf(src, sizeof src, "%s", plan->deb);
    if ((size_t)snprintf(work, sizeof work, "%s/ifizbox-%s.XXXXXX", HELPER_PAID_WORK, tag) >= sizeof work) {
        *err = "work path too long"; return HELPER_EX_IOERR;
    }
    if (!mkdtemp(work)) { *err = "can't make a work directory"; return HELPER_EX_IOERR; }
    chmod(work, 0755); /* apt's _apt user may read the copy; nobody else may write here */
    if ((size_t)snprintf(copy, sizeof copy, "%s/%s.deb", work, tag) >= sizeof copy) {
        rmdir(work); *err = "work path too long"; return HELPER_EX_IOERR;
    }
    int rc = copy_in(from, src, copy, err);
    if (!rc && id && helper_rollback_verify(prefix, copy, id, version, err)) {
        *err = strstr(*err, "isn't that package") ? "the downloaded .deb isn't that package and version"
                                                   : "dpkg-deb couldn't read the downloaded .deb's control";
        rc = HELPER_EX_USAGE;
    }
    if (rc) { remove_work(work, copy); return rc; }
    snprintf(plan->deb, sizeof plan->deb, "%s", copy); /* argv's last word points here */
    char cached[PATH_MAX];
    int seeded = plan->verb != HV_SIMULATE_DEB && seed_archive(prefix, copy, cached, sizeof cached); /* B70 */
    rc = run_apt(plan, env, run, answers, err);
    if (seeded) unlink(cached);
    remove_work(work, copy);
    return rc;
}

int helper_install_paid(const char *prefix, struct helper_plan *plan, char *const env[], const char **err) {
    return run_on_copy(prefix, plan, env, HELPER_PAID_DIR, "paid", plan->name_buf[0], plan->item_buf[0], NULL, -1, err);
}

int helper_local_deb(const char *prefix, struct helper_plan *plan, char *const env[], const char **err) {
    return run_on_copy(prefix, plan, env, HELPER_DEB_DIR, "deb", NULL, NULL, NULL, -1, err);
}

int helper_local_deb_ask(const char *prefix, struct helper_plan *plan, char *const env[], helper_deb_runner run,
                         int answers, const char **err) {
    return run_on_copy(prefix, plan, env, HELPER_DEB_DIR, "deb", NULL, NULL, run, answers, err);
}
