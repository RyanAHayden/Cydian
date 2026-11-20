import Foundation

// native/test_packages_index.py builds this with native/Sources/PackagesIndex.swift (and bzlib.h through
// tests/packagesindex/bridge.h) and runs it on a folder of fixtures it wrote with Python's bz2; "all passed" ends it.
var failed = 0
func check(_ name: String, _ ok: Bool, _ detail: @autoclosure () -> String = "") {
    if ok { print("ok   \(name)") } else { failed += 1; print("FAIL \(name) \(detail())") }
}
let dir = CommandLine.arguments[1]
func file(_ name: String) -> Data { FileManager.default.contents(atPath: dir + "/" + name) ?? Data() }
let plain = file("Packages")

// HTML check: leading whitespace and a BOM are skipped; an index is not HTML.
check("index is not html", !PackagesIndex.looksLikeHTML(plain))
check("html", PackagesIndex.looksLikeHTML(Data("<html><body>moved</body></html>".utf8)))
check("html after blank lines", PackagesIndex.looksLikeHTML(Data("\n\n\r\n  \t<!DOCTYPE html>\n<html>".utf8)))
check("html after BOM", PackagesIndex.looksLikeHTML(Data([0xEF, 0xBB, 0xBF]) + Data("\n<html>".utf8)))
check("empty is not html", !PackagesIndex.looksLikeHTML(Data()))
check("blank only is not html", !PackagesIndex.looksLikeHTML(Data("\n\n  ".utf8)))
check("< later in an index", !PackagesIndex.looksLikeHTML(Data("Package: a\nDescription: <b>\n".utf8)))

// bunzip2
let one = PackagesIndex.bunzip2(file("Packages.bz2"))
check("bz2 unpacks", one == plain, "got \(one?.count ?? -1) bytes, want \(plain.count)")
let multi = PackagesIndex.bunzip2(file("multi.bz2"))
check("concatenated streams", multi == plain + plain, "got \(multi?.count ?? -1) bytes, want \(plain.count * 2)")
let padded = PackagesIndex.bunzip2(file("padded.bz2"))
check("trailing zeros ignored", padded == plain, "got \(padded?.count ?? -1) bytes")
check("truncated is nil", PackagesIndex.bunzip2(file("truncated.bz2")) == nil)
check("damaged is nil", PackagesIndex.bunzip2(file("damaged.bz2")) == nil)
check("html is nil", PackagesIndex.bunzip2(Data("\n\n<html>".utf8)) == nil)
check("empty is nil", PackagesIndex.bunzip2(Data()) == nil)
let big = PackagesIndex.bunzip2(file("big.bz2"))
check("bigger than one chunk", big == file("big"), "got \(big?.count ?? -1) bytes, want \(file("big").count)")

print(failed == 0 ? "all passed" : "\(failed) failed")
exit(failed == 0 ? 0 : 1)
