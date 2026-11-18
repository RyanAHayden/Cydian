/* F57: cydian-helper install-paid <path> <id> <version>: a paid package's .deb that the app downloaded from the
 * vendor's one-time URL (Paid.swift paid.install).
 *
 *   1. Open the .deb without following links: a regular file, one link, owned by the user who owns its directory
 *      (mobile), never root, at most 1 GiB. Copied into a fresh root-owned directory under HELPER_PAID_WORK, so
 *      nothing the caller does afterwards changes what gets installed (as install-ipa does, ipa.c).
 *   2. dpkg-deb reads the copy's control: Package must be the id asked and Version the version (rollback's check).
 *   3. apt-get install <the copy>, as rollback does: apt installs the file and pulls in its dependencies.
 * N9's simulate-deb and install-deb (helper_local_deb) take the same road from HELPER_DEB_DIR, without step 2.
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

/* Copy plan->deb (in `from`) into a fresh root-owned <HELPER_PAID_WORK>/<tag>.XXXXXX/<tag>.deb, check it when `id` is
 * set (install-paid), run plan's apt-get on the copy, remove the directory. */
static int run_on_copy(const char *prefix, struct helper_plan *plan, char *const env[], const char *from, const char *tag,
                       const char *id, const char *version, const char **err) {
    char work[PATH_MAX], copy[PATH_MAX], src[PATH_MAX];
    snprintf(src, sizeof src, "%s", plan->deb);
    if ((size_t)snprintf(work, sizeof work, "%s/cydian-%s.XXXXXX", HELPER_PAID_WORK, tag) >= sizeof work) {
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
    pid_t pid = fork();
    if (pid < 0) { remove_work(work, copy); *err = "can't run apt-get (fork)"; return HELPER_EX_EXEC; }
    if (pid == 0) {
        execve(plan->path, (char *const *)plan->argv, env);
        fprintf(stderr, "cydian-helper: %s: %s\n", plan->path, strerror(errno));
        _exit(HELPER_EX_EXEC);
    }
    int st;
    while (waitpid(pid, &st, 0) < 0)
        if (errno != EINTR) { remove_work(work, copy); *err = "can't wait for apt-get"; return HELPER_EX_EXEC; }
    remove_work(work, copy);
    *err = NULL;
    return WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
}

int helper_install_paid(const char *prefix, struct helper_plan *plan, char *const env[], const char **err) {
    return run_on_copy(prefix, plan, env, HELPER_PAID_DIR, "paid", plan->name_buf[0], plan->item_buf[0], err);
}

int helper_local_deb(const char *prefix, struct helper_plan *plan, char *const env[], const char **err) {
    return run_on_copy(prefix, plan, env, HELPER_DEB_DIR, "deb", NULL, NULL, err);
}
