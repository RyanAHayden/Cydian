/* ifizbox-upgrades' rules (N5), kept apart from the daemon's main so they build and are tested on Linux
 * (test_daemon.py): which lines of apt's plan are upgrades, the notification's words, when to notify and when a
 * check is due.
 * SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef IFIZBOX_UPGRADES_H
#define IFIZBOX_UPGRADES_H

#include <stddef.h>

#define UPD_MAX 2048          /* upgrades kept; more are counted (n) but not listed */
#define UPD_FIELD 256         /* package names and versions are at most 255 bytes (the helper's limit) */
#define UPD_SHOWN 3           /* names in the body before "and n more" */
#define UPD_TEXT 1024         /* room for a title or body */
#define UPD_INTERVAL (23 * 3600) /* "daily": launchd starts us every hour; we check when the last good check
                                    is at least this old: at most 24 hours apart, and a phone that
                                    re-jailbreaks (which reloads the job) still gets one a day */

struct upd_item {
    char id[UPD_FIELD];   /* package id, any ":arch" dropped */
    char from[UPD_FIELD]; /* installed version */
    char to[UPD_FIELD];   /* the version apt would install */
    char name[UPD_FIELD]; /* dpkg status's Name:, or "" (the id is shown then) */
};

struct upd_list {
    int n;      /* upgrades found (may exceed UPD_MAX) */
    int kept;   /* entries in items (min(n, UPD_MAX)) */
    struct upd_item items[UPD_MAX];
};

/* The upgrades in `apt-get -s dist-upgrade` output: every "Inst <id> [<from>] (<to> ...)" line whose versions
 * differ. New installs (no [from]: a new dependency) are not upgrades; Remv/Conf lines are skipped. apt leaves held
 * packages (Ignored Upgrades, apt-mark hold) out of the plan by itself. Returns out->n. */
int upd_parse_simulation(const char *text, struct upd_list *out);

/* Fill items' names from dpkg's status file (the installed stanza's Name:, as Cydia shows it). */
void upd_names_from_status(const char *status, struct upd_list *list);

/* 1 if some upgrade (id=to) is not in state: the last check already told the user about the rest, and the same
 * "3 upgrades" isn't shown again every day. state: upd_state's lines, NULL or "" for none. */
int upd_fresh(const struct upd_list *list, const char *state);

/* The state to keep after a check: "last <unix time>\n", then one "<id>=<to>\n" per upgrade. Returns the length
 * written (as snprintf: the length needed when size is too small). */
size_t upd_state(const struct upd_list *list, long now, char *buf, size_t size);

/* The "last" time in a state, or 0. */
long upd_state_last(const char *state);

/* 1 if a check is due: the last good check is UPD_INTERVAL or more ago, never happened, or is in the future (the
 * clock went back). */
int upd_due(long now, long last);

/* "1 Upgrade" / "<n> Upgrades". */
void upd_title(int n, char *buf, size_t size);

/* "<name> <to> is available." for one, else "<n> upgrades: A, B and C." / "<n> upgrades: A, B, C and <k> more."
 */
void upd_body(const struct upd_list *list, char *buf, size_t size);

#endif
