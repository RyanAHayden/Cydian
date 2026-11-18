/* ifizbox-upgrades' rules (N5): see upgrades.h. SPDX-License-Identifier: GPL-3.0-or-later */
#include "upgrades.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Copy the next token of s (up to a byte in stop, or end of line) into dst; returns its length, or -1 when it is
 * empty or too long. */
static int token(const char *s, const char *stop, char *dst) {
    size_t n = strcspn(s, stop);
    size_t eol = strcspn(s, "\r\n");
    if (eol < n) n = eol;
    if (n == 0 || n >= UPD_FIELD) return -1;
    memcpy(dst, s, n);
    dst[n] = 0;
    return (int)n;
}

int upd_parse_simulation(const char *text, struct upd_list *out) {
    out->n = out->kept = 0;
    if (!text) return 0;
    for (const char *line = text; *line; ) {
        const char *next = line + strcspn(line, "\n");
        if (*next) next++;
        if (!strncmp(line, "Inst ", 5)) {
            struct upd_item it;
            memset(&it, 0, sizeof it);
            const char *p = line + 5;
            int k = token(p, " ", it.id);
            if (k > 0 && p[k] == ' ' && p[k + 1] == '[') {
                p += k + 2;
                k = token(p, "]", it.from);
                if (k > 0 && p[k] == ']' && p[k + 1] == ' ' && p[k + 2] == '(') {
                    p += k + 3;
                    k = token(p, " )", it.to);
                    if (k > 0 && strcmp(it.from, it.to)) {
                        char *colon = strchr(it.id, ':'); /* foo:iphoneos-arm64 */
                        if (colon) *colon = 0;
                        if (out->kept < UPD_MAX) out->items[out->kept++] = it;
                        out->n++;
                    }
                }
            }
        }
        line = next;
    }
    return out->n;
}

static struct upd_item *find(struct upd_list *list, const char *id) {
    for (int i = 0; i < list->kept; i++)
        if (!strcmp(list->items[i].id, id)) return &list->items[i];
    return NULL;
}

static void name_stanza(struct upd_list *list, const char *pkg, const char *name, int installed) {
    struct upd_item *it = pkg[0] && name[0] && installed ? find(list, pkg) : NULL;
    if (it) snprintf(it->name, sizeof it->name, "%s", name);
}

/* The value of a "Key: value" line of length len, trimmed, into dst (left alone when too long). */
static void field(const char *line, size_t len, size_t keylen, char *dst) {
    const char *v = line + keylen, *end = line + len;
    while (v < end && (*v == ' ' || *v == '\t')) v++;
    while (end > v && (end[-1] == '\r' || end[-1] == ' ' || end[-1] == '\t')) end--;
    size_t n = (size_t)(end - v);
    if (n < UPD_FIELD) { memcpy(dst, v, n); dst[n] = 0; }
}

void upd_names_from_status(const char *status, struct upd_list *list) {
    if (!status) return;
    char pkg[UPD_FIELD] = "", name[UPD_FIELD] = "", st[UPD_FIELD] = "";
    for (const char *line = status; *line; ) {
        size_t len = strcspn(line, "\n");
        if (len == 0 || (len == 1 && line[0] == '\r')) { /* end of a stanza */
            name_stanza(list, pkg, name, strlen(st) >= 10 && !strcmp(st + strlen(st) - 10, " installed"));
            pkg[0] = name[0] = st[0] = 0;
        } else if (!strncmp(line, "Package:", 8)) field(line, len, 8, pkg);
        else if (!strncmp(line, "Name:", 5)) field(line, len, 5, name);
        else if (!strncmp(line, "Status:", 7)) field(line, len, 6, st); /* from the colon, so the value keeps a space before its last word */
        line += len + (line[len] ? 1 : 0);
    }
    name_stanza(list, pkg, name, strlen(st) >= 10 && !strcmp(st + strlen(st) - 10, " installed"));
}

int upd_fresh(const struct upd_list *list, const char *state) {
    char key[2 * UPD_FIELD + 2];
    for (int i = 0; i < list->kept; i++) {
        int k = snprintf(key, sizeof key, "%s=%s", list->items[i].id, list->items[i].to);
        int seen = 0;
        for (const char *p = state; p && *p; ) {
            size_t len = strcspn(p, "\n");
            if (len == (size_t)k && !memcmp(p, key, len)) { seen = 1; break; }
            p += len + (p[len] ? 1 : 0);
        }
        if (!seen) return 1;
    }
    return 0;
}

size_t upd_state(const struct upd_list *list, long now, char *buf, size_t size) {
    size_t at = 0;
    int k = snprintf(buf, size, "last %ld\n", now);
    at += (size_t)k;
    for (int i = 0; i < list->kept; i++) {
        k = snprintf(at < size ? buf + at : NULL, at < size ? size - at : 0, "%s=%s\n", list->items[i].id,
                     list->items[i].to);
        at += (size_t)k;
    }
    return at;
}

long upd_state_last(const char *state) {
    for (const char *p = state; p && *p; ) {
        if (!strncmp(p, "last ", 5)) return strtol(p + 5, NULL, 10);
        p += strcspn(p, "\n");
        if (*p) p++;
    }
    return 0;
}

int upd_due(long now, long last) {
    return last <= 0 || last > now || now - last >= UPD_INTERVAL;
}

void upd_title(int n, char *buf, size_t size) {
    if (n == 1) snprintf(buf, size, "1 Upgrade");
    else snprintf(buf, size, "%d Upgrades", n);
}

static const char *shown_name(const struct upd_item *it) { return it->name[0] ? it->name : it->id; }

void upd_body(const struct upd_list *list, char *buf, size_t size) {
    if (size) buf[0] = 0;
    if (list->n <= 0 || list->kept <= 0) return;
    if (list->n == 1) {
        snprintf(buf, size, "%s %s is available.", shown_name(&list->items[0]), list->items[0].to);
        return;
    }
    int shown = list->kept < UPD_SHOWN ? list->kept : UPD_SHOWN;
    int rest = list->n - shown;
    size_t at = (size_t)snprintf(buf, size, "%d upgrades: ", list->n);
#define PUT(...) do { if (at < size) at += (size_t)snprintf(buf + at, size - at, __VA_ARGS__); } while (0)
    for (int i = 0; i < shown; i++) {
        const char *sep = i == 0 ? "" : (rest == 0 && i == shown - 1) ? " and " : ", ";
        PUT("%s%s", sep, shown_name(&list->items[i]));
    }
    if (rest > 0) PUT(" and %d more", rest);
    PUT(".");
#undef PUT
}
