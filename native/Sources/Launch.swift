import UIKit

// B203: the splash never shows another theme (docs/native.md, "Launch screen"). native/launch/make.py ships every
// theme's empty frame in the bundle as LaunchThemes/<key>/ (that theme's launch images and a LaunchScreen.storyboardc
// with its colours), keyed by Settings' palette values.
//
// - Jailbreak build: iOS draws the splash from the bundle's own launch files at every launch (the iPhone 7 keeps no
//   SplashBoard snapshot for it), so on a theme change the root helper copies the theme's set over them
//   (ifizbox-helper launch-theme, native/helper/launch.h) and the next launch opens on that theme. A .deb upgrade
//   puts Classic's back; the check at the page's first app.theme puts the theme's back.
// - Sideload IPA: its signed bundle can't change, so its splash is neutral (Info-sideload.plist: an empty
//   UILaunchScreen, iOS's own background with no bars) and nothing is copied.
// - Both: the in-app cover (WebController.showCover) is the theme's frame, loaded from LaunchThemes/<key>/ as a
//   bundle of its own, so the hand-over to the page shows the right bars whatever the splash was.
//
// Automatic follows the page's resolved theme at the last change: an iPhone that switches appearance while the app
// isn't running opens once on the other tone's frame (the jailbreak splash is one set of files, not two).
enum Splash {
    static let themesDir = "LaunchThemes"
    static let viewNib = "LaunchScreen.storyboardc/Lvc-00-000-view-Lrt-00-000.nib"
    // What the helper copies (launch.h's helper_launch_files; native/test_launch_grounds.py keeps them in step).
    static let files: [String] = ["LaunchStripes", "LaunchNavTop", "LaunchNavBottom", "LaunchTabGloss",
                                  "LaunchNavShadow", "LaunchTabShadow"].flatMap { ["\($0)@2x.png", "\($0)@3x.png"] }
                                 + [viewNib]
    private static let queue = DispatchQueue(label: "ifizbox.splash")

    static func dir(_ key: String) -> String { Bundle.main.bundlePath + "/\(themesDir)/\(key)" }

    // The theme a tone and its palettes open on; a palette this build has no set for takes the tone's default, as
    // Launch.ground does (Classic, OLED Black).
    static func key(dark: Bool, palette: String, lightPalette: String) -> String {
        let k = dark ? palette : lightPalette
        let ok = !k.isEmpty && k.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) }
        if ok, FileManager.default.fileExists(atPath: dir(k) + "/" + viewNib) { return k }
        return dark ? "oled" : "classic"
    }

    // The key this launch opens on: Theme.saved as Theme.launchGround reads it.
    static func launchKey(systemDark: Bool) -> String {
        let s = Theme.saved
        return key(dark: s.style == "dark" || (s.style == "auto" && systemDark), palette: s.darkPalette,
                   lightPalette: s.lightPalette)
    }

    // B180's cover in the theme's colours: LaunchThemes/<key>/LaunchScreen.storyboardc with its own images. nil when
    // that set is missing; then Classic's own storyboard only for Classic, never another theme's bars.
    static func cover(systemDark: Bool) -> UIView? {
        let k = launchKey(systemDark: systemDark)
        if let b = Bundle(path: dir(k)), b.path(forResource: "LaunchScreen", ofType: "storyboardc") != nil,
           let v = UIStoryboard(name: "LaunchScreen", bundle: b).instantiateInitialViewController()?.view {
            v.isUserInteractionEnabled = false
            return v
        }
        return k == "classic" ? Launch.cover() : nil
    }

    // Theme.apply's: make the next launch open on this theme. Jailbreak build only; off the main thread, one at a
    // time, and only when the bundle's files aren't that theme's already (a byte compare of 13 small files).
    static func follow(dark: Bool, palette: String, lightPalette: String) {
        guard AppMode.current == .jailbreak else { return }
        let k = key(dark: dark, palette: palette, lightPalette: lightPalette)
        queue.async {
            guard !installed(k) else { return }
            do {
                let out = try Helper.run(["launch-theme", k], emit: nil)
                if out["code"] as? Int == 0 {
                    clearSnapshots()
                } else {
                    NSLog("\(Brand.name): launch-theme \(k) failed: \(out["stderr"] as? String ?? "")")
                }
            } catch {
                NSLog("\(Brand.name): launch-theme \(k): \(error)")
            }
        }
    }

    static func installed(_ key: String) -> Bool {
        let fm = FileManager.default
        let root = Bundle.main.bundlePath, src = dir(key)
        return files.allSatisfy { f in
            guard let a = fm.contents(atPath: root + "/" + f), let b = fm.contents(atPath: src + "/" + f) else { return false }
            return a == b
        }
    }

    // A cached splash would keep the old theme: drop this app's own SplashBoard snapshots, if iOS keeps any (an app
    // with a container: Library/SplashBoard/Snapshots/sceneID:<id>-default; a jailbreak app shares mobile's Library,
    // so only the entries named for this bundle ID, never the folder). The iPhone 7 (iOS 15) keeps none for the
    // jailbreak app; newer iOS may.
    static func clearSnapshots() {
        guard let id = Bundle.main.bundleIdentifier else { return }
        let dir = NSHomeDirectory() + "/Library/SplashBoard/Snapshots"
        let fm = FileManager.default
        for name in (try? fm.contentsOfDirectory(atPath: dir)) ?? []
        where name == id || name.hasPrefix("sceneID:\(id)-") || name.hasPrefix("\(id) - ") {
            try? fm.removeItem(atPath: dir + "/" + name)
        }
    }
}
