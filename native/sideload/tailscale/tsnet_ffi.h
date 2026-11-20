// tsnet.go's exported functions (the c-archive build.sh makes), for Swift (module TailscaleFFI) and stub.c. Every
// char* returned is JSON; free it with TSFree.
#pragma once
char *TSStart(char *dir, char *hostname);
char *TSStatus(void);
int TSRelay(char *host, int port);
char *TSTest(char *host, int port);
int TSProbe(char *host, int port, int ms);
void TSStop(void);
char *TSLogout(void);
void TSFree(char *p);
