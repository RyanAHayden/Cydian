// Installed tab: empty for now.
export const title = "Installed";

export function render(el, route) {
  el.innerHTML = '<p class="empty"></p>';
  el.querySelector(".empty").textContent = route.path.length ? route.path.join(" / ") : "Nothing installed yet.";
}
