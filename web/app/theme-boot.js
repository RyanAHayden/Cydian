// Before first paint (a classic script in <head>, not a module): put the stored Appearance on <html data-theme> and
// its palette on <html data-palette> (F198) so a dark page never flashes light, or grey. Same rule as
// core/settings.js themeFor() and paletteFor(); screens/settings.js takes over once the app runs.
(function () {
  var a = null, d = null;
  try { a = localStorage.getItem("ifizbox.appearance"); d = localStorage.getItem("ifizbox.darkTheme"); } catch (e) { /* private mode */ }
  // Light unless Dark is chosen, or Automatic on a dark iPhone (the default is Light: iOS 6 had no dark mode).
  var dark = a === "dark" || (a === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  // Dark: OLED Black unless Gunmetal is chosen (F199's menu); light has the one palette.
  var palette = dark ? (d === "gunmetal" ? "gunmetal" : "oled") : "classic";
  root.setAttribute("data-palette", palette);
  // The browser's top bar too (screens/settings.js THEME_COLORS): index.html's meta says light until now.
  var color = { classic: "#4f698b", oled: "#000", gunmetal: "#5f656f" }[palette];
  var metas = document.querySelectorAll('meta[name="theme-color"]:not([media])');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", color);
})();
