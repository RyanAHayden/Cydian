// Which of Cydian's two builds is running (task I2): jailbreak when the N2 root helper is installed at its
// rootless path, sideload otherwise. Plain C so the same file is tested on Linux (native/test_mode.py).
// A sideloaded app is sandboxed, so stat() on /var/jb fails there even on a jailbroken phone: that is sideload
// too, and rightly, since a sandboxed app can't spawn the helper. SPDX-License-Identifier: GPL-3.0-or-later
#include <sys/stat.h>

#define CYDIAN_HELPER "/var/jb/usr/libexec/cydian/cydian-helper"

enum { CYDIAN_MODE_SIDELOAD = 0, CYDIAN_MODE_JAILBREAK = 1 };

// Jailbreak if helper is a regular file someone may execute; anything else (missing, denied, a directory) is sideload.
int cydian_mode_at(const char *helper) {
  struct stat st;
  if (!helper || stat(helper, &st) != 0) return CYDIAN_MODE_SIDELOAD;
  return S_ISREG(st.st_mode) && (st.st_mode & 0111) ? CYDIAN_MODE_JAILBREAK : CYDIAN_MODE_SIDELOAD;
}

int cydian_mode(void) { return cydian_mode_at(CYDIAN_HELPER); }
