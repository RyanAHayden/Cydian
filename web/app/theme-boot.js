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
  // Each tone's theme: dark is OLED Black unless Gunmetal is chosen; light is Classic (the kit's), the only light
  // theme so far: a second one adds its name here, beside its ios6.css block.
  var palette = dark ? (d === "gunmetal" ? "gunmetal" : "oled") : (l === "classic" ? l : "classic");
  root.setAttribute("data-palette", palette);
  // The browser's top bar too (screens/settings.js THEME_COLORS): index.html's meta says light until now.
  var color = { classic: "#4f698b", oled: "#000", gunmetal: "#5f656f" }[palette];
  var metas = document.querySelectorAll('meta[name="theme-color"]:not([media])');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", color);
})();
