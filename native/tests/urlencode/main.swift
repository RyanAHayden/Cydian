import Foundation

// native/test_urlencode.py builds this with native/Sources/URLEncode.swift alone and checks for "all passed".
var failed = 0
func check(_ name: String, _ got: String, _ want: String) {
    if got == want { print("ok   \(name)") } else { failed += 1; print("FAIL \(name): got \(got), want \(want)") }
}

let youmod = "https://raw.githubusercontent.com/MountainofPenguin/Altstore-Repository/main/assets/YouTube Icon.png"
let encoded = "https://raw.githubusercontent.com/MountainofPenguin/Altstore-Repository/main/assets/YouTube%20Icon.png"
check("raw space", URLText.encoded(youmod), encoded)
check("already %20", URLText.encoded(encoded), encoded)
check("trimmed", URLText.encoded("  \(youmod)\n"), encoded)
check("stray %", URLText.encoded("https://a.dev/100% done.png"), "https://a.dev/100%25%20done.png")
check("query kept", URLText.encoded("https://a.dev/x.png?a=1&b=c d#f"), "https://a.dev/x.png?a=1&b=c%20d#f")
check("quotes, braces, brackets", URLText.encoded("https://a.dev/\"{x}\"[1]|^`\\<>"),
      "https://a.dev/%22%7Bx%7D%22%5B1%5D%7C%5E%60%5C%3C%3E")
check("non-ASCII as UTF-8", URLText.encoded("https://a.dev/café.png"), "https://a.dev/caf%C3%A9.png")
check("host left alone", URLText.encoded("https://[::1]:8080/a b"), "https://[::1]:8080/a%20b")
check("no path", URLText.encoded("https://a.dev"), "https://a.dev")
check("not a URL", URLText.encoded("not a url"), "not a url")
check("URL(string:) takes it", URL(string: URLText.encoded(youmod))?.lastPathComponent ?? "nil", "YouTube Icon.png")

print(failed == 0 ? "all passed" : "\(failed) failed")
exit(failed == 0 ? 0 : 1)
