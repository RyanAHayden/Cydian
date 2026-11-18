/* The app's side: run ifizbox-helper as root (docs/native.md, "3. Root"). SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef IFIZBOX_HELPER_SPAWN_H
#define IFIZBOX_HELPER_SPAWN_H

#include <sys/types.h>

/* Spawn helper with args (NULL-terminated, not counting argv[0]) as root through the persona spawn attributes
 * (Apple; on Linux, for tests, as the current user). stdin is /dev/null; *out_fd, *err_fd and *status_fd get the
 * read ends of pipes on the child's fds 1, 2 and 3 (close-on-exec in this process). The caller reads them to EOF
 * and waitpid()s *pid. Returns 0, or an errno value with nothing left open. */
int ifizbox_helper_spawn(const char *helper, const char *const args[], pid_t *pid, int *out_fd, int *err_fd,
                        int *status_fd);

/* F63: the same, with a pipe on the child's stdin instead of /dev/null: *in_fd gets its write end (close-on-exec
 * here). For ifizbox-helper apply-ask, whose answers ("Y\n" / "N\n") go there; the caller closes it when done. */
int ifizbox_helper_spawn_in(const char *helper, const char *const args[], pid_t *pid, int *in_fd, int *out_fd,
                           int *err_fd, int *status_fd);

#endif
