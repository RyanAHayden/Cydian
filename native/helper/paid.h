/* F57: install-paid's work (paid.c), apart from main() so it builds and is tested on Linux (test_helper.py).
 * SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef CYDIAN_HELPER_PAID_H
#define CYDIAN_HELPER_PAID_H

#include "policy.h"

/* Where install-paid makes its root-owned work directory (cydian-paid.XXXXXX, removed at the end). Tests build with
 * their own -DHELPER_PAID_WORK. */
#ifndef HELPER_PAID_WORK
#define HELPER_PAID_WORK "/var/tmp"
#endif
#define HELPER_PAID_MAX_SIZE (1LL << 30) /* no tweak .deb comes near it */

/* Do an install-paid plan (helper_plan checked the path, id and version): copy the caller's .deb into a fresh
 * root-owned directory, check the copy's control (helper_rollback_verify: Package id, Version version), run apt-get
 * install on the copy with env, remove the directory. Returns apt-get's exit status (128 + signal), or
 * HELPER_EX_USAGE (not the app's plain file, or not that package and version), HELPER_EX_IOERR (couldn't copy) or
 * HELPER_EX_EXEC with *err set. */
int helper_install_paid(const char *prefix, struct helper_plan *plan, char *const env[], const char **err);

#endif
