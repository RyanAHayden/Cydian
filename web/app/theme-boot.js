// Before first paint (a classic script in <head>, not a module): put the stored Theme settings on <html data-theme>
// (the tone) and <html data-palette> (that tone's theme, F198) so a dark page never flashes light, or grey. F199: Mode
// (ifizbox.appearance) picks the tone, ifizbox.lightTheme and ifizbox.darkTheme the theme in each. Same rule as
// core/settings.js themeState(); screens/settings.js applyTheme() takes over once the app runs.
(function () {
  var a = null, l = null, d = null;
  try {
    a = localStorage.getItem("ifizbox.appearance");
    l = localStorage.getItem("ifizbox.lightTheme");
    d = localStorage.getItem("ifizbox.darkTheme");
  } catch (e) { /* private mode */ }
  // Light unless Dark is chosen, or Automatic on a dark iPhone (the default is Light: iOS 6 had no dark mode).
  var dark = a === "dark" || (a === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  // A reload on Theme > Light or Theme > Dark shows that list's preview (screens/settings.js previewOf).
  var m = /^#\/(?:home\/)?settings\/(?:(?:theme|display)\/)?(lightTheme|darkTheme)\/?$/.exec((window.location && window.location.hash) || "");
  if (m) dark = m[1] === "darkTheme";
  var root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  // Each tone's theme (the first is the default): a new theme adds its name here, beside its ios6.css or
  // palettes.css block (F200), and its top-bar colour below.
  var darks = ["oled", "gunmetal", "midnight", "linen", "nord", "dracula"], lights = ["classic", "sepia", "solarized"];
  var palette = dark ? (darks.indexOf(d) >= 0 ? d : darks[0]) : (lights.indexOf(l) >= 0 ? l : lights[0]);
  root.setAttribute("data-palette", palette);
  // The browser's top bar too (screens/settings.js THEME_COLORS): index.html's meta says light until now.
  var color = { classic: "#4f698b", oled: "#000", gunmetal: "#5f656f", midnight: "#0a1424", linen: "#000",
    nord: "#2e3440", dracula: "#21222c", sepia: "#7a5c36", solarized: "#2a74a8" }[palette];
  var metas = document.querySelectorAll('meta[name="theme-color"]:not([media])');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", color);
})();

// Rotation fix for the Home Screen app (iOS 15, iPhone 7, opaque status bar): back in portrait after landscape, its view
// comes back screen-tall (667pt) but still 20pt below the status bar, so its bottom hangs off the screen. clientHeight
// says 667 while only innerHeight (647) shows: the tab bar was cut off and the whole page, nav bar too, scrolled natively.
// A reload doesn't cure it and a see-through status bar is worse (a black band at launch). So: lift the bottom by the
// gap (--vgap, in style.css --safe-bottom), keep html to the visible height and the document at the top.
(function () {
  if (!(window.navigator && navigator.standalone)) return;
  var de = document.documentElement, gap = 0;
  function fit() {
    gap = innerWidth < innerHeight ? Math.max(0, de.clientHeight - innerHeight) : 0;
    de.style.setProperty("--vgap", gap + "px");
    de.style.height = gap ? innerHeight + "px" : "";
    if (gap && scrollY) scrollTo(0, 0);
  }
  fit();
  addEventListener("resize", fit);
  addEventListener("orientationchange", function () { setTimeout(fit, 500); });
  addEventListener("scroll", function () { if (gap && scrollY) scrollTo(0, 0); });
})();
