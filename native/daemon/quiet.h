/* F65: Settings' Upgrade Notifications for cydian-upgrades. The app's switch (core/settings.js upgradeNotifications)
 * writes <prefix>/var/lib/cydian/upgrades.off through `cydian-helper notifications off` and deletes it for on.
 * With the file there, N5's "3 Upgrades" notification turns into a badge-only update: no banner and no sound, but
 * the icon still counts the upgrades (the App Icon Badge row is a setting of its own). N7's "Packages Updated" and
 * "Update Failed" still post: they report installs the user turned on under Automatic Installs.
 * Header-only, so main.m and the host test (test_quiet.py) use the same rule. SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef CYDIAN_QUIET_H
#define CYDIAN_QUIET_H

#include "auto.h"

#define QUIET_FILE "/var/lib/cydian/upgrades.off" /* under the jailbreak prefix; native/helper HELPER_NOTIFY_OFF */

/* The kind of note to send (AUTO_NOTE_*) for one auto_step asks for, with upgrade notifications off or on. */
static inline int quiet_kind(int kind, int off) {
    return off && kind == AUTO_NOTE_UPGRADES ? AUTO_NOTE_BADGE : kind;
}

#endif
