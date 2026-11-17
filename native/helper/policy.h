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
#define HELPER_EX_IOERR 74  /* F33: cydian.sources couldn't be read or written */

enum helper_verb { HV_UPDATE, HV_INSTALL, HV_REMOVE, HV_UPGRADE, HV_CONFIGURE, HV_HOLD, HV_UNHOLD, HV_SHOWHOLD,
                   HV_ADDSOURCE, HV_REMOVESOURCE };
#define HELPER_VERBS "update, install, remove, upgrade, configure, hold, unhold, showhold, addsource, removesource"

/* F33: the one file addsource/removesource edit, under the prefix. Nothing else in apt's sources is touched. */
#define HELPER_SOURCES_FILE "/etc/apt/sources.list.d/cydian.sources"
#define HELPER_URI_MAX 1024
#define HELPER_SUITE_MAX 255
#define HELPER_COMPONENT_MAX 64
#define HELPER_MAX_COMPONENTS 16

struct helper_plan {
    enum helper_verb verb;
    char path[PATH_MAX];  /* executable to execve: <prefix>/usr/bin/apt-get, apt-mark or dpkg; for addsource and
                             removesource, the file they edit (<prefix>HELPER_SOURCES_FILE), and argv is the verb,
                             URI, suite and components as given (nothing is executed) */
    const char *argv[HELPER_MAX_PACKAGES + 24]; /* NULL-terminated */
    int argc;
    const char *const *packages; /* the caller's package names, inside argv */
    int npackages;
};

/* 1 if s is a package name the helper passes on: [a-z0-9][a-z0-9.+-]+, at most HELPER_NAME_MAX bytes. */
int helper_name_ok(const char *s);

/* Turn the caller's words (argv[0] is the verb: one of HELPER_VERBS) into the one command the helper may run.
 * status_fd >= 0 adds apt-get's/dpkg's status-fd option on it (apt-mark gets none). Returns 0, or -1 with *err set. */
int helper_plan(int argc, char *const argv[], const char *prefix, int status_fd, struct helper_plan *plan,
                const char **err);

/* F33: 1 if s is a URI addsource writes: http:// or https:// (lower case), a host of [A-Za-z0-9.-] with an
 * optional :port, then a path that starts and ends with "/" of [A-Za-z0-9._~%+/:=,-] with no "." or ".." segment.
 * No user:password (the file is world-readable), whitespace, "#", quotes or brackets; at most HELPER_URI_MAX bytes. */
int helper_uri_ok(const char *s);
/* 1 if s is a suite: a flat path ending in "/" ("./", "sub/") or a distribution name. [A-Za-z0-9._+/-], not
 * starting with "-" or "/", no ".." segment, at most HELPER_SUITE_MAX bytes. */
int helper_suite_ok(const char *s);
/* 1 if s is a component: [A-Za-z0-9][A-Za-z0-9._+/-]*, no ".." and not ending in "/", at most HELPER_COMPONENT_MAX. */
int helper_component_ok(const char *s);

/* F33: do an addsource or removesource plan on <prefix>HELPER_SOURCES_FILE: read it (a missing file is empty),
 * drop every stanza naming exactly this URI and suite, append the new one (addsource), and write the result to a
 * temp file in the same directory, renamed over the old one (mode 0644). *changed says whether anything changed
 * (an add of a source that is there as is, or a remove of one that isn't, leaves the file alone). 0, or -1 + *err. */
int helper_sources_apply(const struct helper_plan *plan, int *changed, const char **err);

/* Every package of an install must be named "Package: <name>" in dpkg's status or one of apt's *_Packages lists;
 * of a remove, hold or unhold, in dpkg's status. That keeps apt from reading a name it doesn't know as a regex or a modifier
 * ("foo-" removes, "foo+" installs). Returns the index of the first unknown package, or -1 when all are known. */
int helper_first_unknown(const char *prefix, const struct helper_plan *plan);

/* The defence-in-depth caller check (the kernel's persona-mgmt entitlement check is the real one): real and
 * effective uid are root_uid, and parent_exe is the same file (device + inode) as expected_exe. 0 or -1 + *err. */
int helper_caller_ok(uid_t uid, uid_t euid, uid_t root_uid, const char *parent_exe, const char *expected_exe,
                     const char **err);

#endif
