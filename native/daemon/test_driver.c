/* Host driver for test_daemon.py: runs upgrades.c's rules on files. SPDX-License-Identifier: GPL-3.0-or-later
 *   test_driver check <sim> <status|-> <state|-> <now>
 *     prints: n=<count>, one "item <id> <from> <to> <name>" per kept upgrade, fresh=<0|1>, title=, body=,
 *     due=<0|1> (from the state's "last"), then the new state's lines, each as "state <line>" */
#include "upgrades.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *slurp(const char *path) {
    if (!strcmp(path, "-")) return NULL;
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); exit(2); }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    rewind(f);
    char *b = malloc((size_t)n + 1);
    if (!b || fread(b, 1, (size_t)n, f) != (size_t)n) exit(2);
    b[n] = 0;
    fclose(f);
    return b;
}

static struct upd_list list;

int main(int argc, char **argv) {
    if (argc != 6 || strcmp(argv[1], "check")) { fprintf(stderr, "usage: test_driver check sim status state now\n"); return 2; }
    char *sim = slurp(argv[2]), *status = slurp(argv[3]), *state = slurp(argv[4]);
    long now = strtol(argv[5], NULL, 10);
    upd_parse_simulation(sim, &list);
    upd_names_from_status(status, &list);
    printf("n=%d\n", list.n);
    for (int i = 0; i < list.kept; i++)
        printf("item %s %s %s %s\n", list.items[i].id, list.items[i].from, list.items[i].to, list.items[i].name);
    char t[UPD_TEXT], b[UPD_TEXT];
    upd_title(list.n, t, sizeof t);
    upd_body(&list, b, sizeof b);
    printf("fresh=%d\ntitle=%s\nbody=%s\ndue=%d\n", upd_fresh(&list, state), t, b, upd_due(now, upd_state_last(state)));
    size_t need = upd_state(&list, now, NULL, 0);
    char *s = malloc(need + 1);
    if (upd_state(&list, now, s, need + 1) != need) return 3;
    for (char *line = strtok(s, "\n"); line; line = strtok(NULL, "\n")) printf("state %s\n", line);
    return 0;
}
