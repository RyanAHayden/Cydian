// Entry point: builds the tab bar and one container per tab, then lets the router switch between them.
import { TABS, createRouter, format } from "./router.js";
import * as home from "./screens/home.js";
import * as sources from "./screens/sources.js";
import * as changes from "./screens/changes.js";
import * as installed from "./screens/installed.js";
import * as search from "./screens/search.js";

const SCREENS = { home, sources, changes, installed, search };

const screensEl = document.getElementById("screens");
const tabbarEl = document.getElementById("tabbar");
const titleEl = document.getElementById("title");
const views = {};
const tabs = {};

for (const tab of TABS) {
  const view = document.createElement("section");
  view.className = "screen";
  view.dataset.tab = tab;
  view.hidden = true;
  screensEl.append(view);
  views[tab] = view;

  const a = document.createElement("a");
  a.className = "tab";
  a.dataset.tab = tab;
  a.href = format({ tab });
  a.innerHTML = '<span class="tab-icon" aria-hidden="true"></span><span class="tab-label"></span>';
  a.querySelector(".tab-label").textContent = SCREENS[tab].title;
  tabbarEl.append(a);
  tabs[tab] = a;
}

const router = createRouter({
  win: window,
  onRoute(route, previous) {
    if (!previous || previous.tab !== route.tab) {
      for (const tab of TABS) {
        views[tab].hidden = tab !== route.tab;
        tabs[tab].classList.toggle("active", tab === route.tab);
        if (tab === route.tab) tabs[tab].setAttribute("aria-current", "page");
        else tabs[tab].removeAttribute("aria-current");
      }
    }
    SCREENS[route.tab].render(views[route.tab], route);
    titleEl.textContent = SCREENS[route.tab].title;
  },
});

// Tab taps go through selectTab so each tab keeps its place; the href is there for no-JS fallbacks and a11y.
tabbarEl.addEventListener("click", (e) => {
  const a = e.target.closest("a.tab");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  router.selectTab(a.dataset.tab);
});

router.start();
