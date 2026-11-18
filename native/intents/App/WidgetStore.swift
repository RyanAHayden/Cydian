// N8: the app's side of the Home Screen widget (native/widget/): the update count goes into the App Group's defaults
// (WidgetShare, ../Core.swift) and the widget is told to reload. Called by Check for Updates and Install All Updates
// (Intents.swift) and by the page's app.badge (Sources/Notifications.swift), which sends Changes' count whenever it
// changes. Without the App Group (a signer whose profile has none) there is nowhere to write: the widget then shows
// "Open Cydian". Kept apart from Intents.swift: WidgetKit and AppIntents in one file pull in a strongly linked
// cross-import overlay (see there).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import WidgetKit

enum WidgetStore {
    static func save(count: Int, names: [String], now: Date = Date()) {
        guard let d = UserDefaults(suiteName: WidgetShare.group) else { return }
        let old = WidgetShare.decode(d.object(forKey: WidgetShare.key))
        let s = WidgetShare.Snapshot(count: max(0, count), names: names, checked: now)
        d.set(WidgetShare.encode(s), forKey: WidgetShare.key)
        // A reload costs one of the widget's daily budget: only when what it shows changes.
        if old?.count != s.count { WidgetCenter.shared.reloadTimelines(ofKind: WidgetShare.kind) }
    }
}
