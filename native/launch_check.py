"""The launch screen's part of mkdeb.py/mkipa.py check (docs/native.md, "Launch screen").

B180: Info.plist names a launch storyboard (UILaunchStoryboardName LaunchScreen), compiled on a Mac by
native/launch/storyboard.sh, whose bars are pinned to the safe area so the splash lines up with the page's first
frame on every screen. The storyboard names loose PNGs (native/launch/make.py) in the app's top folder at @2x and @3x.
UILaunchScreen (N10) can't do that: its bar images are stretched and its image is drawn centred at its own size.
"""

STORYBOARD = "LaunchScreen"
# Every image LaunchScreen.storyboard names (its <resources>).
IMAGES = ("LaunchStripes", "LaunchNavTop", "LaunchNavBottom", "LaunchTabGloss", "LaunchNavShadow", "LaunchTabShadow")


def problems(info, files, app):
    """Problems with info's launch screen; files maps bundle paths to bytes, app is the iFizBox.app/ prefix."""
    out = []
    name = info.get("UILaunchStoryboardName")
    if name != STORYBOARD:
        out.append("Info.plist UILaunchStoryboardName is %r, want %r (without a launch screen iOS letterboxes the app)"
                   % (name, STORYBOARD))
    if "UILaunchScreen" in info:
        out.append("Info.plist has UILaunchScreen as well as the storyboard: its bars only fit screens whose size is known")
    sbc = app + STORYBOARD + ".storyboardc/"
    if not files.get(sbc + "Info.plist") or not any(n.startswith(sbc) and n.endswith(".nib") for n in files):
        out.append("launch storyboard %s.storyboardc missing or not compiled (native/launch/storyboard.sh)" % STORYBOARD)
    for img in IMAGES:
        for scale in ("@2x", "@3x"):
            png = files.get(app + img + scale + ".png")
            if not png or not png.startswith(b"\x89PNG"):
                out.append("launch image %s%s.png missing" % (img, scale))
    return out
