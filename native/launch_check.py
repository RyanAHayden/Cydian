"""N10: the launch screen's part of mkdeb.py/mkipa.py check: Info.plist's UILaunchScreen and the images it names.

UILaunchScreen names images without a compiled asset catalog, so they must be loose PNGs in the app's top folder at
@2x and @3x (docs/native.md, "Launch screen"). UIColorName can only name an asset catalog colour, and the app has no
Assets.car, so it must not be there (an empty one is what the app had before N10: a black launch). The app's own
cover until the page draws (App.swift, LaunchCover) reads the website's per-screen launch images from web/icons/launch/.
"""

WANT = {"UIImageName": "LaunchLoading", "UINavigationBar": "LaunchNavBar", "UITabBar": "LaunchTabBar"}


def problems(info, files, app):
    """Problems with info's UILaunchScreen; files maps bundle paths to bytes, app is the Cydian.app/ prefix."""
    out = []
    ls = info.get("UILaunchScreen")
    if not isinstance(ls, dict):
        return ["Info.plist has no UILaunchScreen dict (without one iOS letterboxes the app)"]
    names = [ls.get("UIImageName")] + [(ls.get(k) or {}).get("UIImageName") for k in ("UINavigationBar", "UITabBar")]
    for key, name in zip(WANT, names):
        if name != WANT[key]:
            out.append("Info.plist UILaunchScreen %s image is %r, want %r" % (key, name, WANT[key]))
            continue
        for scale in ("@2x", "@3x"):
            png = files.get(app + name + scale + ".png")
            if not png or not png.startswith(b"\x89PNG"):
                out.append("launch image %s%s.png missing" % (name, scale))
    if "UIColorName" in ls:
        out.append("Info.plist UILaunchScreen has UIColorName, but the app has no asset catalog to name a colour in")
    if ls.get("UIImageRespectsSafeAreaInsets") is not False:
        out.append("Info.plist UILaunchScreen UIImageRespectsSafeAreaInsets must be false (the pinstripes fill the screen)")
    if not any(n.startswith(app + "web/icons/launch/launch-") and n.endswith(".png") for n in files):
        out.append("web/icons/launch/ has no launch-<W>x<H>.png (the app's cover until the page draws)")
    return out
