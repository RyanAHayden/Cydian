# N6 findings

## Rootless jailbreak (palera1n, iOS 15.8.8): binaries need no-container or no-sandbox
On the iPhone 7, any Mach-O started outside an app container (by hand over ssh, by launchd, or spawned by the app)
is SIGKILLed at exec (exit 137, no output, no crash log) unless its signature carries
`com.apple.private.security.no-container` or `com.apple.private.security.no-sandbox`. `platform-application` alone
is not enough. Procursus signs its tools with no-container. `mkdeb.check` enforces this for the helper and the
daemon (`UNSANDBOXED`). New binaries in the .deb need it too.
