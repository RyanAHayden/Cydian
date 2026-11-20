/* Host driver for test_auto.py: auto.c's decisions on files, and whole daemon runs (auto_step) against a fake phone,
 * clock and apt in a folder. SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   auto_driver settings <settings|->                  check= cellular= install= idle= respring= keep=
 *   auto_driver check <settings|-> <now> <last> <none|wifi|cell> <force>    no | go | wait-wifi
 *   auto_driver may <settings|-> <charging> <locked> <none|wifi|cell>       now | wait-idle | wait-net
 *   auto_driver pick <plan> <settings|-> <held|-> <state|->                one chosen id per line
 *   auto_driver removes|finish|list <file>              the answer as a number
 *   auto_driver action <settings|-> <need> <locked>     nothing | notify | respring | wait
 *   auto_driver pending <since> <sb_started> <now>      0 | 1
 *   auto_driver debver <file> <id>                      the version, or "no"
 *   auto_driver prune <listing> <id> <installed> <keep> the files to delete
 *   auto_driver words <plan> <status|-> <id,id,...|-> <need>   title=, body=, failed=
 *   auto_driver state <plan> <id,...|-> <failed> <old state|-> <since>     auto_state's lines
 *   auto_driver linked <lists> <id=version>...          B16: the pairs offered with a full-URL Filename
 *   auto_driver installs <plan>                         B16: id=version of each Inst line
 *   auto_driver url <filename>                          B16: 1 if it is a full URL
 *   auto_driver step <dir> [--force] [--no-update] [--dry-run]
 *
 * step's folder: facts ("now <t>", "net <none|wifi|cell>", "charging <0|1>", "locked <0|1>", "sb <t>", "busy <0|1>"), settings,
 * held, state, status, info/, cache/, rollback/, lists/ (apt's *_Packages); the fake apt answers from plan (dist-upgrade before an install),
 * plan.after (after one; plan when missing), plan.install (install --only-upgrade -s) and install.out, with exit
 * codes from codes ("update <n>", "simulate <n>", "siminstall <n>", "install <n>", all 0 when missing). An install
 * moves download/'s files into cache/, as apt's download would. Every call is printed, one per line. */
#define _POSIX_C_SOURCE 200809L
#include "auto.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static char *slurp(const char *path) {
    if (!strcmp(path, "-")) return NULL;
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    rewind(f);
    char *b = malloc((size_t)n + 1);
    if (!b || fread(b, 1, (size_t)n, f) != (size_t)n) exit(2);
    b[n] = 0;
    fclose(f);
    return b;
}

static int net_of(const char *s) { return !strcmp(s, "wifi") ? AUTO_NET_WIFI : !strcmp(s, "cell") ? AUTO_NET_CELL : AUTO_NET_NONE; }

static struct upd_list list, list2;
static unsigned char chosen[UPD_MAX];

/* chosen[] from "a,b,c" (or "-": none). */
static void choose(const char *csv) {
    for (int i = 0; i < list.kept; i++) {
        chosen[i] = 0;
        if (!strcmp(csv, "-")) continue;
        size_t il = strlen(list.items[i].id);
        for (const char *p = csv; *p; ) {
            size_t n = strcspn(p, ",");
            if (n == il && !memcmp(p, list.items[i].id, n)) chosen[i] = 1;
            p += n + (p[n] ? 1 : 0);
        }
    }
}

/* --- the fake phone */

static const char *dir;
static int after_install;

static char *path(const char *name) {
    static char buf[8][4096];
    static int k;
    char *b = buf[k++ % 8];
    snprintf(b, sizeof buf[0], "%s/%s", dir, name);
    return b;
}

static long fact(const char *key, long dflt) {
    char *t = slurp(path("facts"));
    long v = dflt;
    size_t kl = strlen(key);
    for (char *p = t; p && *p; ) {
        if (!strncmp(p, key, kl) && p[kl] == ' ') {
            const char *val = p + kl + 1;
            v = !strncmp(val, "wifi", 4) ? AUTO_NET_WIFI : !strncmp(val, "cell", 4) ? AUTO_NET_CELL
              : !strncmp(val, "none", 4) ? AUTO_NET_NONE : strtol(val, NULL, 10);
        }
        p += strcspn(p, "\n");
        if (*p) p++;
    }
    free(t);
    return v;
}

static int code_of(const char *what) {
    char *t = slurp(path("codes"));
    int v = 0;
    size_t kl = strlen(what);
    for (char *p = t; p && *p; ) {
        if (!strncmp(p, what, kl) && p[kl] == ' ') v = atoi(p + kl + 1);
        p += strcspn(p, "\n");
        if (*p) p++;
    }
    free(t);
    return v;
}

static void print_ids(const char *verb, const char *const *ids, int n) {
    printf("%s", verb);
    for (int i = 0; i < n; i++) printf(" %s", ids[i]);
    printf("\n");
}

static char *f_settings(void *c) { (void)c; return slurp(path("settings")); }
static char *f_held(void *c) { (void)c; printf("showhold\n"); return slurp(path("held")); }
static long f_now(void *c) { (void)c; return fact("now", 1800000000); }
static int f_net(void *c) { (void)c; return (int)fact("net", AUTO_NET_WIFI); }
static int f_charging(void *c) { (void)c; return (int)fact("charging", 0); }
static int f_locked(void *c) { (void)c; return (int)fact("locked", 0); }
static long f_sb(void *c) { (void)c; return fact("sb", 0); }
static int f_busy(void *c) { (void)c; return (int)fact("busy", 0); }
static int f_update(void *c) { (void)c; printf("update\n"); return code_of("update"); }
static int f_simulate(void *c, const char *const *ids, int n, char **out) {
    (void)c;
    print_ids("simulate", ids, n);
    if (n) { *out = slurp(path("plan.install")); return code_of("siminstall"); }
    *out = after_install ? slurp(path("plan.after")) : NULL;
    if (!*out) *out = slurp(path("plan"));
    return code_of("simulate");
}
static int f_install(void *c, const char *const *ids, int n, char **out) {
    (void)c;
    print_ids("install", ids, n);
    after_install = 1;
    DIR *d = opendir(path("download"));
    if (d) {
        struct dirent *e;
        while ((e = readdir(d))) {
            if (e->d_name[0] == '.') continue;
            char from[4096], to[4096];
            snprintf(from, sizeof from, "%s/download/%s", dir, e->d_name);
            snprintf(to, sizeof to, "%s/cache/%s", dir, e->d_name);
            rename(from, to);
        }
        closedir(d);
    }
    *out = slurp(path("install.out"));
    return code_of("install");
}
static void f_respring(void *c) { (void)c; printf("respring\n"); }
static void f_notify(void *c, int kind, int badge, const char *title, const char *body) {
    (void)c;
    static const char *const kinds[] = {"upgrades", "updated", "failed", "badge"};
    if (kind == AUTO_NOTE_BADGE) printf("badge %d\n", badge);
    else printf("notify %s %d %s | %s\n", kinds[kind], badge, title, body);
}
static void f_say(void *c, const char *msg) { (void)c; printf("say %s\n", msg); }

int main(int argc, char **argv) {
    if (argc < 2) return 2;
    const char *cmd = argv[1];
    struct auto_settings s;
    if (!strcmp(cmd, "settings") && argc == 3) {
        auto_settings_parse(slurp(argv[2]), &s);
        printf("check=%d cellular=%d install=%d idle=%d respring=%d keep=%d\n", s.check, s.cellular, s.install, s.idle,
               s.respring, s.keep);
    } else if (!strcmp(cmd, "check") && argc == 7) {
        auto_settings_parse(slurp(argv[2]), &s);
        static const char *const r[] = {"no", "go", "wait-wifi"};
        printf("%s\n", r[auto_check(&s, atol(argv[3]), atol(argv[4]), net_of(argv[5]), atoi(argv[6]))]);
    } else if (!strcmp(cmd, "may") && argc == 6) {
        auto_settings_parse(slurp(argv[2]), &s);
        static const char *const r[] = {"now", "wait-idle", "wait-net"};
        printf("%s\n", r[auto_may_install(&s, atoi(argv[3]), atoi(argv[4]), net_of(argv[5]))]);
    } else if (!strcmp(cmd, "pick") && argc == 6) {
        char *settings = slurp(argv[3]);
        auto_settings_parse(settings, &s);
        upd_parse_simulation(slurp(argv[2]), &list);
        auto_pick(&list, &s, settings, slurp(argv[4]), slurp(argv[5]), chosen);
        for (int i = 0; i < list.kept; i++)
            if (chosen[i]) printf("%s\n", list.items[i].id);
    } else if (!strcmp(cmd, "samever") && argc == 4) {
        printf("%d\n", auto_same_version(argv[2], argv[3]));
    } else if (!strcmp(cmd, "drop") && argc == 4) {
        /* auto_driver drop <plan> <settings>    the count left, then the ids left */
        upd_parse_simulation(slurp(argv[2]), &list);
        auto_drop_ignored(&list, slurp(argv[3]));
        printf("%d\n", list.n);
        for (int i = 0; i < list.kept; i++) printf("%s\n", list.items[i].id);
    } else if (!strcmp(cmd, "removes") && argc == 3) {
        printf("%d\n", auto_plan_removes(slurp(argv[2])));
    } else if (!strcmp(cmd, "finish") && argc == 3) {
        printf("%d\n", auto_finish(slurp(argv[2])));
    } else if (!strcmp(cmd, "list") && argc == 3) {
        printf("%d\n", auto_list_needs_respring(slurp(argv[2])));
    } else if (!strcmp(cmd, "action") && argc == 5) {
        auto_settings_parse(slurp(argv[2]), &s);
        static const char *const r[] = {"nothing", "notify", "respring", "wait"};
        printf("%s\n", r[auto_respring_action(&s, atoi(argv[3]), atoi(argv[4]))]);
    } else if (!strcmp(cmd, "pending") && argc == 5) {
        printf("%d\n", auto_respring_pending(atol(argv[2]), atol(argv[3]), atol(argv[4])));
    } else if (!strcmp(cmd, "debver") && argc == 4) {
        char v[UPD_FIELD];
        printf("%s\n", auto_deb_version(argv[2], argv[3], v, sizeof v) ? v : "no");
    } else if (!strcmp(cmd, "prune") && argc == 6) {
        char out[65536];
        int n = auto_prune(slurp(argv[2]), argv[3], argv[4], atoi(argv[5]), out, sizeof out);
        printf("%s", out);
        int lines = 0;
        for (char *p = out; *p; p++) lines += *p == '\n';
        if (lines != n) return 3;
    } else if (!strcmp(cmd, "words") && argc == 6) {
        upd_parse_simulation(slurp(argv[2]), &list);
        upd_names_from_status(slurp(argv[3]), &list);
        choose(argv[4]);
        int n = 0;
        for (int i = 0; i < list.kept; i++) n += chosen[i];
        char t[UPD_TEXT], b[UPD_TEXT], f[UPD_TEXT];
        auto_title(n, t, sizeof t);
        auto_body(&list, chosen, atoi(argv[5]), b, sizeof b);
        auto_failed_body(&list, chosen, f, sizeof f);
        printf("title=%s\nbody=%s\nfailed=%s\n", t, b, f);
    } else if (!strcmp(cmd, "state") && argc == 7) {
        upd_parse_simulation(slurp(argv[2]), &list);
        choose(argv[3]);
        char *old = slurp(argv[5]);
        size_t need = auto_state(&list, chosen, atoi(argv[4]), old, atol(argv[6]), NULL, 0);
        char *b = malloc(need + 1);
        if (auto_state(&list, chosen, atoi(argv[4]), old, atol(argv[6]), b, need + 1) != need || strlen(b) != need) return 3;
        printf("%s", b);
    } else if (!strcmp(cmd, "linked") && argc >= 3) {
        /* auto_driver linked <lists dir> <id=version>...   the linked pairs, one per line */
        static char pid[UPD_MAX][UPD_FIELD], pver[UPD_MAX][UPD_FIELD];
        static const char *qi[UPD_MAX], *qv[UPD_MAX];
        static unsigned char hit[UPD_MAX];
        int n = 0;
        for (int i = 3; i < argc && n < UPD_MAX; i++, n++) {
            const char *eq = strchr(argv[i], '=');
            if (!eq) return 2;
            snprintf(pid[n], UPD_FIELD, "%.*s", (int)(eq - argv[i]), argv[i]);
            snprintf(pver[n], UPD_FIELD, "%s", eq + 1);
            qi[n] = pid[n]; qv[n] = pver[n];
        }
        int k = auto_linked(argv[2], qi, qv, n, hit), seen = 0;
        for (int i = 0; i < n; i++)
            if (hit[i]) { printf("%s=%s\n", qi[i], qv[i]); seen++; }
        if (seen != k) return 3;
    } else if (!strcmp(cmd, "installs") && argc == 3) {
        /* auto_driver installs <plan>    id=version per Inst line */
        static char pid[UPD_MAX][UPD_FIELD], pver[UPD_MAX][UPD_FIELD];
        int k = auto_plan_installs(slurp(argv[2]), pid, pver, UPD_MAX);
        for (int i = 0; i < k; i++) printf("%s=%s\n", pid[i], pver[i]);
    } else if (!strcmp(cmd, "url") && argc == 3) {
        printf("%d\n", auto_url_filename(argv[2]));
    } else if (!strcmp(cmd, "step") && argc >= 3) {
        dir = argv[2];
        int force = 0, update = 1, dry = 0;
        for (int i = 3; i < argc; i++) {
            if (!strcmp(argv[i], "--force")) force = 1;
            else if (!strcmp(argv[i], "--no-update")) update = 0;
            else if (!strcmp(argv[i], "--dry-run")) dry = 1;
            else return 2;
        }
        struct auto_env env = {
            .state_path = path("state"), .status_path = path("status"), .info_dir = path("info"),
            .cache_dir = path("cache"), .rollback_dir = path("rollback"), .lists_dir = path("lists"),
            .settings = f_settings, .held = f_held, .now = f_now, .net = f_net, .charging = f_charging,
            .locked = f_locked, .springboard_started = f_sb, .busy = f_busy, .update = f_update, .simulate = f_simulate,
            .install = f_install, .respring = f_respring, .notify = f_notify, .say = f_say,
        };
        /* path() hands out 8 rotating buffers: copy the six kept in env. */
        static char p[6][4096];
        strcpy(p[0], env.state_path); strcpy(p[1], env.status_path); strcpy(p[2], env.info_dir);
        strcpy(p[3], env.cache_dir); strcpy(p[4], env.rollback_dir); strcpy(p[5], env.lists_dir);
        env.state_path = p[0]; env.status_path = p[1]; env.info_dir = p[2]; env.cache_dir = p[3]; env.rollback_dir = p[4];
        env.lists_dir = p[5];
        return auto_step(&env, force, update, dry, &list, &list2);
    } else {
        fprintf(stderr, "usage: see auto_driver.c\n");
        return 2;
    }
    return 0;
}
