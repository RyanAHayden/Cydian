/* cydian-helper: the one place Cydian's root work goes through (docs/native.md, "3. Root").
 *
 *   cydian-helper update | upgrade | configure | install <pkg>... | remove <pkg>...
 *   cydian-helper hold <pkg>... | unhold <pkg>... | showhold
 *
 * No setuid bit: Cydian spawns it as root with the persona spawn attributes (spawn.c), which the kernel allows
 * only because Cydian is signed with com.apple.private.persona-mgmt. Run by anything else it is plain mobile and
 * refuses. It runs exactly one of apt-get update|install|remove|upgrade, apt-mark hold|unhold|showhold or
 * dpkg --configure -a from the rootless
 * prefix, with fixed options; the caller only picks the verb and package names ([a-z0-9][a-z0-9.+-]+, known to
 * dpkg or apt). If fd 3 is open, apt's/dpkg's status lines go there (pmstatus:pkg:percent:text); stdout and stderr
 * are apt's own. Exit: 64 refused arguments, 77 refused caller, 126 exec failed, else apt's/dpkg's status.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later */
#include "policy.h"

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef __APPLE__
/* <libproc.h> ships in the macOS SDK but not the iOS one; proc_pidpath is in libSystem on iOS too, so declare it
 * ourselves (as Sileo and Zebra do). */
#include <stdint.h>
int proc_pidpath(int pid, void *buffer, uint32_t buffersize);
#endif

#ifndef CYDIAN_PREFIX
#define CYDIAN_PREFIX "/var/jb"
#endif
/* Only test builds change this (test_helper.py runs the chain as a normal user); the iOS build keeps 0. */
#ifndef CYDIAN_ROOT_UID
#define CYDIAN_ROOT_UID 0
#endif

static int parent_exe(char *buf, size_t size) {
#ifdef __APPLE__
    return proc_pidpath(getppid(), buf, (uint32_t)size) > 0 ? 0 : -1;
#else
    char link[64];
    snprintf(link, sizeof link, "/proc/%d/exe", (int)getppid());
    ssize_t n = readlink(link, buf, size - 1);
    if (n < 0) return -1;
    buf[n] = 0;
    return 0;
#endif
}

int main(int argc, char *argv[]) {
    const char *prefix = CYDIAN_PREFIX, *err = NULL;
    char parent[PATH_MAX], expected[PATH_MAX];

    snprintf(expected, sizeof expected, "%s/Applications/Cydian.app/Cydian", prefix);
    if (helper_caller_ok(getuid(), geteuid(), CYDIAN_ROOT_UID, parent_exe(parent, sizeof parent) ? NULL : parent,
                         expected, &err)) {
        fprintf(stderr, "cydian-helper: %s\n", err);
        return HELPER_EX_NOPERM;
    }

    int status_fd = fcntl(3, F_GETFD) != -1 ? 3 : -1;
    struct helper_plan plan;
    if (helper_plan(argc - 1, argv + 1, prefix, status_fd, &plan, &err)) {
        fprintf(stderr, "cydian-helper: %s\n", err);
        return HELPER_EX_USAGE;
    }
    int unknown = helper_first_unknown(prefix, &plan);
    if (unknown >= 0) {
        fprintf(stderr, "cydian-helper: unknown package: %s\n", plan.packages[unknown]);
        return HELPER_EX_USAGE;
    }

    /* A clean process for apt: no fds but 0-2 (and 3), stdin from /dev/null, cwd /, default signals, umask 022,
     * and an environment of our own (the caller's could carry APT_CONFIG, LD_ or DYLD_ variables and so on). */
    long maxfd = sysconf(_SC_OPEN_MAX);
    if (maxfd < 0 || maxfd > 65536) maxfd = 65536;
    for (int fd = status_fd >= 0 ? 4 : 3; fd < maxfd; fd++) close(fd);
    int null = open("/dev/null", O_RDONLY);
    if (null < 0 || dup2(null, 0) < 0) { perror("cydian-helper: /dev/null"); return HELPER_EX_EXEC; }
    if (null != 0) close(null);
    for (int s = 1; s < NSIG; s++) signal(s, SIG_DFL);
    sigset_t none;
    sigemptyset(&none);
    sigprocmask(SIG_SETMASK, &none, NULL);
    umask(022);
    if (chdir("/")) { perror("cydian-helper: chdir"); return HELPER_EX_EXEC; }

    static char path_env[PATH_MAX * 2];
    snprintf(path_env, sizeof path_env,
             "PATH=%1$s/usr/bin:%1$s/bin:%1$s/usr/sbin:%1$s/sbin:/usr/bin:/bin:/usr/sbin:/sbin", prefix);
    char *env[] = {path_env, "HOME=/var/root", "USER=root", "LOGNAME=root", "LANG=C", "DEBIAN_FRONTEND=noninteractive",
                   NULL};
    execve(plan.path, (char *const *)plan.argv, env);
    fprintf(stderr, "cydian-helper: %s: %s\n", plan.path, strerror(errno));
    return HELPER_EX_EXEC;
}
