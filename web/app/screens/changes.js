// Changes tab: empty for now.
export const title = "Changes";

export function render(el, route) {
  el.innerHTML = '<p class="empty"></p>';
  el.querySelector(".empty").textContent = route.path.length ? route.path.join(" / ") : "No changes yet.";
}
