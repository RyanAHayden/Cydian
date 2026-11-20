// The jailbreak build's stand-in for tsnet.go (native/build.sh links libtsnet.a into the sideload app only): every
// call says Tailscale isn't in this build. The jailbreak app installs IPAs through its helper.
#include <stdlib.h>
#include <string.h>
#include "tsnet_ffi.h"

static char *none(void) { return strdup("{\"error\":\"jailbreak: Tailscale installs are in the sideload app only\"}"); }
char *TSStart(char *dir, char *hostname) { (void)dir; (void)hostname; return none(); }
char *TSStatus(void) { return strdup("{\"running\":false}"); }
int TSRelay(char *host, int port) { (void)host; (void)port; return 0; }
char *TSTest(char *host, int port) { (void)host; (void)port; return none(); }
int TSProbe(char *host, int port, int ms) { (void)host; (void)port; (void)ms; return -2; }
void TSStop(void) {}
char *TSLogout(void) { return none(); }
void TSFree(char *p) { free(p); }
