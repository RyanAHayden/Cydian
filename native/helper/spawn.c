/* See spawn.h. SPDX-License-Identifier: GPL-3.0-or-later */
#include "spawn.h"

#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>

#ifdef __APPLE__
/* Private, from xnu's spawn_private.h; Sileo and Zebra declare them the same way. Allowed only with the
 * com.apple.private.persona-mgmt entitlement. */
#define POSIX_SPAWN_PERSONA_FLAGS_OVERRIDE 1
int posix_spawnattr_set_persona_np(const posix_spawnattr_t *__restrict, uid_t, uint32_t);
int posix_spawnattr_set_persona_uid_np(const posix_spawnattr_t *__restrict, uid_t);
int posix_spawnattr_set_persona_gid_np(const posix_spawnattr_t *__restrict, gid_t);
#endif

extern char **environ;

/* A pipe whose ends sit at fd 10 or above, both close-on-exec, so dup2 onto 1-3 always copies (dup2(3, 3) would
 * keep close-on-exec and lose the fd). */
static int high_pipe(int p[2]) {
    int raw[2], e = 0;
    if (pipe(raw)) return errno;
    p[0] = fcntl(raw[0], F_DUPFD_CLOEXEC, 10);
    if (p[0] < 0) e = errno;
    p[1] = e ? -1 : fcntl(raw[1], F_DUPFD_CLOEXEC, 10);
    if (!e && p[1] < 0) e = errno;
    close(raw[0]);
    close(raw[1]);
    if (e && p[0] >= 0) close(p[0]);
    return e;
}

int cydian_helper_spawn(const char *helper, const char *const args[], pid_t *pid, int *out_fd, int *err_fd,
                        int *status_fd) {
    return cydian_helper_spawn_in(helper, args, pid, NULL, out_fd, err_fd, status_fd);
}

int cydian_helper_spawn_in(const char *helper, const char *const args[], pid_t *pid, int *in_fd, int *out_fd,
                           int *err_fd, int *status_fd) {
    /* pipes[3] is the child's stdin (F63), made only when in_fd asks for it */
    int pipes[4][2], made = 0, rc, want = in_fd ? 4 : 3;
    for (; made < want; made++)
        if ((rc = high_pipe(pipes[made]))) goto fail;

    size_t n = 0;
    while (args[n]) n++;
    char **argv = calloc(n + 2, sizeof *argv);
    if (!argv) { rc = ENOMEM; goto fail; }
    argv[0] = (char *)helper;
    for (size_t i = 0; i < n; i++) argv[i + 1] = (char *)args[i];

    posix_spawn_file_actions_t fa;
    posix_spawnattr_t attr;
    posix_spawn_file_actions_init(&fa);
    posix_spawnattr_init(&attr);
    if (in_fd) posix_spawn_file_actions_adddup2(&fa, pipes[3][0], 0);
    else posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
    for (int i = 0; i < 3; i++) posix_spawn_file_actions_adddup2(&fa, pipes[i][1], i + 1);
#ifdef __APPLE__
    /* Nothing of the app's leaks into the root process: only the fds set up above survive. */
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_CLOEXEC_DEFAULT);
    posix_spawnattr_set_persona_np(&attr, 99, POSIX_SPAWN_PERSONA_FLAGS_OVERRIDE);
    posix_spawnattr_set_persona_uid_np(&attr, 0);
    posix_spawnattr_set_persona_gid_np(&attr, 0);
#endif
    rc = posix_spawn(pid, helper, &fa, &attr, argv, environ);
    posix_spawn_file_actions_destroy(&fa);
    posix_spawnattr_destroy(&attr);
    free(argv);
    if (rc) goto fail;
    for (int i = 0; i < 3; i++) close(pipes[i][1]);
    if (in_fd) {
        close(pipes[3][0]);
        *in_fd = pipes[3][1];
    }
    *out_fd = pipes[0][0];
    *err_fd = pipes[1][0];
    *status_fd = pipes[2][0];
    return 0;

fail:
    for (int i = 0; i < made; i++) close(pipes[i][0]), close(pipes[i][1]);
    return rc;
}
