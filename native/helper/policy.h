/* cydian-helper's checks, kept apart from main() so they build and are tested on Linux (test_helper.py).
 * SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef CYDIAN_HELPER_POLICY_H
#define CYDIAN_HELPER_POLICY_H

#include <limits.h>
#include <sys/types.h>

#define HELPER_MAX_PACKAGES 256
#define HELPER_NAME_MAX 255

/* Exit codes of the helper itself (sysexits.h values); anything else is apt's or dpkg's own. */
#define HELPER_EX_USAGE 64  /* refused: verb, package name or unknown package */
#define HELPER_EX_NOPERM 77 /* refused: caller isn't Cydian running as root */
#define HELPER_EX_EXEC 126  /* apt-get or dpkg couldn't be run */

enum helper_verb { HV_UPDATE, HV_INSTALL, HV_REMOVE, HV_UPGRADE, HV_CONFIGURE };

struct helper_plan {
    enum helper_verb verb;
    char path[PATH_MAX];  /* executable to execve: <prefix>/usr/bin/apt-get or dpkg */
    const char *argv[HELPER_MAX_PACKAGES + 24]; /* NULL-terminated */
    int argc;
    const char *const *packages; /* the caller's package names, inside argv */
    int npackages;
};

/* 1 if s is a package name the helper passes on: [a-z0-9][a-z0-9.+-]+, at most HELPER_NAME_MAX bytes. */
int helper_name_ok(const char *s);

/* Turn the caller's words (argv[0] is the verb: update, install, remove, upgrade, configure) into the one command
 * the helper may run. status_fd >= 0 adds apt's/dpkg's status-fd option on it. Returns 0, or -1 with *err set. */
int helper_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *plan,
                const char **err);

/* Every package of an install must be named "Package: <name>" in dpkg's status or one of apt's *_Packages lists;
 * of a remove, in dpkg's status. That keeps apt from reading a name it doesn't know as a regex or a modifier
 * ("foo-" removes, "foo+" installs). Returns the index of the first unknown package, or -1 when all are known. */
int helper_first_unknown(const char *prefix, const struct helper_plan *plan);

/* The defence-in-depth caller check (the kernel's persona-mgmt entitlement check is the real one): real and
 * effective uid are root_uid, and parent_exe is the same file (device + inode) as expected_exe. 0 or -1 + *err. */
int helper_caller_ok(uid_t uid, uid_t euid, uid_t root_uid, const char *parent_exe, const char *expected_exe,
                     const char **err);

#endif
