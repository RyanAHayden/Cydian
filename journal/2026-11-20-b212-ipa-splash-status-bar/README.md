# B212 IPA splash status bar

The sideload IPA's splash is the neutral empty `UILaunchScreen` (white in light mode, black in dark), but it
inherited `UIStatusBarStyle = UIStatusBarStyleLightContent` from native/Info.plist, so the clock and icons
were white on white in light mode during launch.

## What I did

- native/Info-sideload.plist: `UIStatusBarStyle = UIStatusBarStyleDefault`. mkipa.py's `merge_plist` overlays
  it on the base Info.plist, so only the IPA changes. Default is dark text on a light appearance and light
  text on a dark one, which matches the white or black splash.
- After launch nothing changes: `UIViewControllerBasedStatusBarAppearance` isn't set in either plist (so it
  is YES by default), and the root controller's `preferredStatusBarStyle` (.lightContent,
  native/Sources/App.swift) still sets the style once the controller is on screen.
- The jailbreak build keeps LightContent, because its storyboard splash has the blue bar.
- native/test_ipa.py: `test_splash_status_bar_reads_on_white_and_black` checks that the merged IPA plist has
  the empty UILaunchScreen and Default, leaves view-controller-based appearance on, and that the base
  Info.plist keeps LightContent. `python3 -m unittest test_ipa`: 18 tests OK.

## Not verified

- I didn't look at it on a device or in the Simulator. The MBA (Simulator host, sim/run.sh) timed out on ssh
  (`ssh: connect to host mbas-macbook-air port 22: Connection timed out`). To check, open the IPA in light
  mode on iOS 26 and see that the splash status bar is dark, and that it turns light over the blue nav bar
  once the page shows.
