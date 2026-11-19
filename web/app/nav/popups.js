// B56: is a popup up? Every alert, action sheet, share sheet, modal sheet, progress sheet and full-screen layer marks
// itself as a dialog (role="dialog"/"alertdialog", aria-modal) while it is in the page, and leaves the page when it
// has closed. The website holds its automatic new-build reload until the last one is gone (screens/home.js
// refreshIfNewBuild), so a popup (?install's Install iFizBox First) never vanishes under the user.
export const POPUPS = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]';

const shown = (el) => !el.getClientRects || el.getClientRects().length > 0;

export function popupOpen(doc = globalThis.document) {
  if (!doc?.querySelectorAll) return false;
  return [...doc.querySelectorAll(POPUPS)].some(shown);
}

// Resolves once no popup is up (at once when none is). Watches the page for removed nodes; `poll` ms is a fallback
// for a popup hidden without leaving the page.
export function whenNoPopup(doc = globalThis.document, { poll = 1000, Observer = globalThis.MutationObserver } = {}) {
  if (!popupOpen(doc)) return Promise.resolve();
  return new Promise((resolve) => {
    let obs = null;
    let timer = null;
    const check = () => {
      if (popupOpen(doc)) return;
      obs?.disconnect();
      clearInterval(timer);
      resolve();
    };
    if (typeof Observer === "function" && doc.body) {
      obs = new Observer(check);
      obs.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "aria-modal", "hidden"] });
    }
    timer = setInterval(check, poll);
  });
}
