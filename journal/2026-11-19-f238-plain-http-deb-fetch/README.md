# F238: queue run downloads .debs from plain-http sources in the shell too

## What changed

- `native/share/HTTPStream.swift` (new): one HTTP/1.1 answer decoded as its bytes arrive (Content-Length, chunked,
  close-delimited; 1xx skipped; header capped at 32 KB), so a download can stream to a file. Pure Foundation, so
  the Linux tests run it (`native/share/tests/main.swift`, "http stream: …", fed in pieces of 1, 2, 3, 7 and 1000
  bytes; short bodies, broken chunks, non-HTTP and endless headers fail).
- `native/Sources/Icons.swift`: `PlainDownload`, the http counterpart of `Download` (SignBridge.swift) over
  Network.framework's TCP, as `PlainGet` does for net.icon. Progress when a Content-Length comes, the size cap
  (`ShareInbox.maxDeb`, checked against Content-Length up front and against the bytes as they arrive), cancel() ->
  "cancelled: Cancelled", 60 s without a byte -> timeout, up to 5 redirects (http stays here, https goes to
  `Download`). It holds itself until done (the connection's handlers hold it weakly, and untagged fetches have no
  other owner). `protocol DebFetch { cancel() }` covers both, for `DebFetches`.
- `native/share/App/ShareBridge.swift`: share.debFetch picks PlainDownload for http, Download for https; the
  classify / stanza hash check after the download is unchanged and runs for both.

## Checked

- `native/share/test_share.py` passes (the new decoder test included); `native/build.sh deb` builds.
- iPhone 7, iOS 15.8.8: queued Filza (BigBoss, http, 10.2 MB) with its four Procursus deps. Filza's row showed
  "Downloading 0.0 of 10.2 MB" beside the other downloads, the log said "Downloading Filza File Manager 10.2 MB" with
  no "apt downloads it as it installs" line, and apt said "Need to get 0 B/10.2 MB": the shell's file was installed,
  after its SHA256 matched the stanza. Filza and the deps were removed afterwards.

## What went wrong on the way

- The first phone run fell back to apt for Filza. The installed app wasn't my build: another session had put its
  own .deb on the phone between my install and the run (the binary had no `ifizbox.deb.http`). Reinstalling and
  re-running gave the result above. Worth knowing: check the app binary (md5 or a string) right before a phone test.

## Not verified

- The progress row moving between 0 and 100 %: BigBoss sent 10.2 MB in about a second, so the screenshots caught
  only "0.0 of 10.2 MB" and then "Installed". Progress events come from the same path as Download's.
- Redirects (http -> http, http -> https), chunked or close-delimited bodies, the 60 s timeout and Cancel on the
  phone: BigBoss answers 200 with a Content-Length. The decoder's cases are covered by the Linux test; the
  NWConnection side of those paths only by reading.
- An https link that redirects to http still fails under ATS in `Download` and falls back to apt as before (no repo
  seen doing that).
