/* F59: install-ipa's work (ipa.c), kept apart from main() so the parts that aren't installd build and are tested on
 * Linux (test_helper.py). SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef CYDIAN_HELPER_IPA_H
#define CYDIAN_HELPER_IPA_H

#include <stddef.h>

/* Where install-ipa makes its root-owned work directory (cydian-ipa.XXXXXX, removed at the end). Tests build with
 * their own -DHELPER_IPA_WORK. */
#ifndef HELPER_IPA_WORK
#define HELPER_IPA_WORK "/var/tmp"
#endif

/* Install the IPA at ipa (already checked by helper_plan: HELPER_IPA_DIR/<name>.ipa). Children (unzip, ldid) get
 * env. fd3 >= 0 gets pmstatus lines. Returns 0, or an exit code (HELPER_EX_USAGE: not an IPA or not the app's
 * file; HELPER_EX_IOERR: couldn't copy or unpack; HELPER_EX_ADHOC: can't install ad hoc; 1: installd refused it)
 * with *err set. */
int helper_install_ipa(const char *prefix, const char *ipa, int fd3, char *const env[], const char **err);

/* 1 if AppSync Unified's installd tweak is in the prefix (ElleKit's or Substrate's tweak directory). */
int helper_ipa_appsync(const char *prefix);

/* 1 if s is a bundle identifier the helper passes to installd: [A-Za-z0-9.-], not starting with "." or "-", at
 * most 255 bytes. */
int helper_ipa_bundle_id_ok(const char *s);

/* CFBundleIdentifier of an Info.plist (data, len) into out; 0, or -1 when it's missing or not a good id. iOS reads
 * any plist format, other systems the XML one only. */
int helper_ipa_plist_id(const char *data, size_t len, char *out, size_t size);

#endif
