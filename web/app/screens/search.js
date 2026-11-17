// Search tab: empty until F5 adds the search bar and results.
export const title = "Search";

export function nav() {
  return { title: "Search", style: "plain" };
}

export function render(el, route) {
  el.innerHTML = '<p class="empty"></p>';
  el.querySelector(".empty").textContent = route.path.length ? route.path.join(" / ") : "Search packages.";
}
