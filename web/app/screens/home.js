// Home tab: empty for now.
export const title = "Home";

export function render(el, route) {
  el.innerHTML = '<p class="empty"></p>';
  el.querySelector(".empty").textContent = route.path.length ? route.path.join(" / ") : "Welcome to Cydian.";
}
