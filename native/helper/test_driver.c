/* Test-only front end to policy.c and spawn.c for test_helper.py; not shipped.
 *   test_driver name <s>...                    print "ok" or "bad" per name
 *   test_driver plan <prefix> <status_fd> <verb> [args]...   print the exec path and argv, one per line, or "error: ..."
 *   test_driver known <prefix> <verb> <pkg>... print the first unknown package or "all known"
 *   test_driver apply <prefix> <verb> [args]...  F33: addsource/removesource on the prefix; "changed",
 *                                              "unchanged" or "error: ..."
 *   test_driver uri|suite|component <s>...     print "ok" or "bad" per string <uid> <euid> <root_uid> <parent_exe> <expected>   print "ok" or "error: ..."
 *   test_driver ipapath <dir> <path>...        F59: print "ok" or "bad" per path (helper_ipa_path_ok)
 *   test_driver plistid <file>                 F59: the Info.plist's CFBundleIdentifier, or "bad"
 *   test_driver appsync <prefix>               F59: "yes" or "no"
 *   test_driver spawn <helper> [args]...       spawn helper, print its streams as "1: ...", "2: ...", "3: ..."
 *                                              lines, then "exit: <code>"
 * SPDX-License-Identifier: GPL-3.0-or-later */
#include "ipa.h"
#include "policy.h"
#include "spawn.h"

#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static int spawn(int argc, char **argv) {
    pid_t pid;
    int fds[3];
    int rc = cydian_helper_spawn(argv[0], (const char *const *)argv + 1, &pid, &fds[0], &fds[1], &fds[2]);
    if (rc) { printf("spawn error: %s\n", strerror(rc)); return 1; }
    (void)argc;
    /* Read the three pipes as they come, like the app's console will; lines tagged by fd. */
    char buf[3][8192];
    size_t used[3] = {0, 0, 0};
    struct pollfd pf[3];
    for (int i = 0; i < 3; i++) pf[i] = (struct pollfd){fds[i], POLLIN, 0};
    int open_fds = 3;
    while (open_fds) {
        if (poll(pf, 3, 10000) <= 0) { printf("timeout\n"); return 1; }
        for (int i = 0; i < 3; i++) {
            if (pf[i].fd < 0 || !pf[i].revents) continue;
            ssize_t n = read(pf[i].fd, buf[i] + used[i], sizeof buf[i] - 1 - used[i]);
            if (n <= 0) {
                if (used[i]) printf("%d: %.*s\n", i + 1, (int)used[i], buf[i]);
                close(pf[i].fd);
                pf[i].fd = -1;
                open_fds--;
                continue;
            }
            used[i] += (size_t)n;
            char *nl;
            while ((nl = memchr(buf[i], '\n', used[i]))) {
                size_t len = (size_t)(nl - buf[i]);
                printf("%d: %.*s\n", i + 1, (int)len, buf[i]);
                memmove(buf[i], nl + 1, used[i] - len - 1);
                used[i] -= len + 1;
            }
        }
    }
    int st;
    waitpid(pid, &st, 0);
    printf("exit: %d\n", WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st));
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2) return 2;
    const char *cmd = argv[1], *err = NULL;
    if (!strcmp(cmd, "name")) {
        for (int i = 2; i < argc; i++) printf("%s\n", helper_name_ok(argv[i]) ? "ok" : "bad");
    } else if (!strcmp(cmd, "plan") && argc >= 4) {
        struct helper_plan p;
        if (helper_plan(argc - 4, argv + 4, argv[2], atoi(argv[3]), &p, &err)) printf("error: %s\n", err);
        else {
            printf("%s\n", p.path);
            for (int i = 0; p.argv[i]; i++) printf("%s\n", p.argv[i]);
        }
    } else if (!strcmp(cmd, "known") && argc >= 4) {
        struct helper_plan p;
        if (helper_plan(argc - 3, argv + 3, argv[2], -1, &p, &err)) { printf("error: %s\n", err); return 0; }
        int i = helper_first_unknown(argv[2], &p);
        printf("%s\n", i < 0 ? "all known" : p.packages[i]);
    } else if (!strcmp(cmd, "uri") || !strcmp(cmd, "suite") || !strcmp(cmd, "component")) {
        int (*ok)(const char *) = cmd[0] == 'u' ? helper_uri_ok : cmd[0] == 's' ? helper_suite_ok : helper_component_ok;
        for (int i = 2; i < argc; i++) printf("%s\n", ok(argv[i]) ? "ok" : "bad");
    } else if (!strcmp(cmd, "apply") && argc >= 4) {
        struct helper_plan p;
        int changed;
        if (helper_plan(argc - 3, argv + 3, argv[2], -1, &p, &err) || helper_sources_apply(&p, &changed, &err))
            printf("error: %s\n", err);
        else printf("%s\n", changed ? "changed" : "unchanged");
    } else if (!strcmp(cmd, "caller") && argc == 7) {
        if (helper_caller_ok((uid_t)atol(argv[2]), (uid_t)atol(argv[3]), (uid_t)atol(argv[4]), argv[5], argv[6], &err))
            printf("error: %s\n", err);
        else printf("ok\n");
    } else if (!strcmp(cmd, "ipapath") && argc >= 3) {
        for (int i = 3; i < argc; i++) printf("%s\n", helper_ipa_path_ok(argv[2], argv[i]) ? "ok" : "bad");
    } else if (!strcmp(cmd, "plistid") && argc == 3) {
        static char buf[1 << 20];
        char id[HELPER_NAME_MAX + 1];
        FILE *f = fopen(argv[2], "rb");
        size_t n = f ? fread(buf, 1, sizeof buf, f) : 0;
        if (f) fclose(f);
        printf("%s\n", helper_ipa_plist_id(buf, n, id, sizeof id) ? "bad" : id);
    } else if (!strcmp(cmd, "appsync") && argc == 3) {
        printf("%s\n", helper_ipa_appsync(argv[2]) ? "yes" : "no");
    } else if (!strcmp(cmd, "spawn") && argc >= 3) {
        return spawn(argc - 2, argv + 2);
    } else return 2;
    return 0;
}
