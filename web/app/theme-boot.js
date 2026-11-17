// Before first paint (a classic script in <head>, not a module): put the stored Appearance on <html data-theme> so
// a dark page never flashes light. Same rule as core/settings.js themeFor(); screens/settings.js takes over once
// the app runs.
(function () {
  var a = null;
  try { a = localStorage.getItem("cydian.appearance"); } catch (e) { /* private mode */ }
  var dark = a === "dark" || (a !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
