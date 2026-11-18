# native/widget/: the widget extension (N8)

`Cydian.app/PlugIns/CydianWidget.appex`, bundle id `com.ryha.cydian.widget`, arm64, iOS 17+ (the app stays iOS 15+;
on 15 and 16 iOS just doesn't load the extension). `build.sh <jailbreak|sideload> <app>` builds it; `native/build.sh`
calls it for each bundle.

- `Widget.swift`: Updates, a small Home Screen widget and circular/inline Lock Screen ones showing the update count.
  The count is the App Group's snapshot (`group.com.ryha.cydian`, `WidgetShare` in `../intents/Core.swift`), written
  by the app (`../intents/App/WidgetStore.swift`: Check for Updates, Install All Updates, and every count the page
  shows in Changes through `app.badge`); the jailbreak build also reads N5's daemon state
  (`/var/jb/var/lib/cydian/upgrades.state`) and shows the newer. The timeline reloads hourly and when the app's count
  changes.
- `Controls.swift` (jailbreak build only, `-D CYDIAN_JAILBREAK`): Respring and Userspace Reboot as Control Center
  controls (iOS 18), so also for the Action button. Their intents run in the extension, which has the app's jailbreak
  entitlements (`entitlements.plist`) and spawns `cydian-helper` itself (`../intents/App/Host.swift`,
  `../helper/spawn.c`); `Metadata.appintents` for them comes from `../intents/metadata.py` as for the app.
- The sideload IPA's extension has neither: `entitlements-sideload.plist` (the App Group only), no intents.
  `mkipa.py check` refuses an IPA whose extension has intents or jailbreak entitlements.
