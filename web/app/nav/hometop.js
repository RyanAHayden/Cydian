// Home always starts at the top (user 2026-11-18). Home's root page keeps its own scroller (.page-body) like every
// page, so switching tabs, popping and the app going to the background all leave it where it was scrolled. Three
// cases put it back at the top; everything else (other tabs, Back to Home from a page pushed on it) keeps the place:
//   opened()     the app opens on Home: cold launch, back from the background (including Settings' Return to Home
//                After, which routes there itself), a Home Screen web app restored from the back/forward cache.
//                Not while something is up (alert, sheet, install progress): that stays as the user left it.
//   tabTapped()  a tap on the Home tab from another tab, or from a page pushed on Home (which pops to the root):
//                the root jumps to its top while hidden, so it shows at the top. A tap on Home's root itself is
//                tabbar.js tapTab's slide to the top (F148), not this.
// No DOM here beyond a scroller's scrollTop: homeRoot() returns Home's root .page-body (or null before it exists),
// current() the route on screen, overlayUp() whether an alert, sheet or HUD is showing.

export const isHomeRoot = (route) => !!route && route.tab === "home" && route.path.length === 0;

export function createHomeTop({ homeRoot, current, overlayUp = () => false }) {
  const jump = () => {
    const body = homeRoot();
    if (!body || body.scrollTop <= 0) return false;
    body.scrollTop = 0;
    return true;
  };
  return {
    // The app came to the front (or launched). True when Home was moved to the top.
    opened() {
      if (!isHomeRoot(current()) || overlayUp()) return false;
      return jump();
    },
    // Called in the tab bar's click handler before tapTab: `tab` was tapped while current() is on screen.
    tabTapped(tab) {
      if (tab !== "home" || isHomeRoot(current())) return false;
      return jump();
    },
  };
}

// Home's root .page-body from the app's stacks (nav/stack.js): the entry of Home's stack whose path is [].
export const homeRootOf = (stacks) => () => stacks.stack("home").find((e) => e.path.length === 0)?.page.body ?? null;
