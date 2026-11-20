// ---- B83: iFizBox's own update after iOS's prompt -----------------------------------------------------------
import { CLOSE_BY_HAND, RETURN_LABEL, CLOSING_LABEL, CLOSE_GRACE, unlockSelfUpdate } from "../nav/progress.js";
import { NAME } from "../brand.js";
import { bridge } from "./common.js";

export const SELF_UPDATE_LINES = {
  waiting: `Finishing the update: waiting for iOS to download the new ${NAME}`,
  downloading: `Finishing the update: iOS is downloading the new ${NAME}`,
  finished: `iOS has the new ${NAME}. Closing so it can install it`,
};
export const SELF_UPDATE_FAILED = {
  notStarted: `The update didn't start: iOS didn't download the new ${NAME}. If Install was pressed, try again.`,
  stalled: `The update didn't finish: iOS stopped downloading the new ${NAME}.`,
};
// B123: `waiting` (the page was locked on WAITING_LABEL): finished or guessed turn it to CLOSING_LABEL, and if iFizBox
// is still here CLOSE_GRACE later, or the shell can't be followed (older shell, none running), the page unlocks with
// CLOSE_BY_HAND. Without it, B83's behaviour (the caller's CLOSING_LABEL lock stays).
export async function followSelfUpdate(h, { native, retry = null, waiting = false, later = setTimeout } = {}) {
  let closing = false;
  const byHand = () => {
    if (h?.page?.closed || typeof h?.finish !== "function") return;
    h.page?.error?.(CLOSE_BY_HAND);
    h.finish({ label: RETURN_LABEL, status: "Done" });
  };
  const close = () => {
    if (closing || !waiting || typeof h?.finish !== "function") return;
    closing = true;
    h.finish({ label: CLOSING_LABEL, status: "Done", locked: true });
    later(byHand, CLOSE_GRACE);
  };
  let last = null;
  const say = (s) => {
    if (s === "finished" || s === "guessed") close();
    if (s && s !== last && SELF_UPDATE_LINES[s]) { last = s; h?.page?.step?.(SELF_UPDATE_LINES[s]); }
  };
  const s = await watchSelfUpdate(say, native);
  say(s);
  if (SELF_UPDATE_FAILED[s]) unlockSelfUpdate(h, { message: SELF_UPDATE_FAILED[s], retry });
  else if (waiting && !s) byHand();
  return s;
}

// B159: This iPhone, iFizBox itself: on iOS 17.4+ installd waits for the running copy to go instead of ending it, so
// the shell answers the install once installd stands still and then closes itself (native CloseForUpdate.hereReady,
// signing.selfUpdate "finished"). Then the page locks on "Closing iFizBox" with the shell's line, as the hosted route
// does, and says to close it by hand if iFizBox is still here CLOSE_GRACE later. -> true when it is closing; false
// (installd answered while iFizBox lived, or an older shell) leaves the caller's "close it by hand" end.
export const HERE_CLOSING_LINE = `iOS has the new ${NAME} and is waiting for this one to close. Closing so it can finish installing it`;
export async function followHereSelf(h, { native, later = setTimeout } = {}) {
  const s = await watchSelfUpdate(() => {}, native);
  if (s !== "finished" || typeof h?.finish !== "function") return false;
  h.page?.step?.(HERE_CLOSING_LINE);
  h.finish({ label: CLOSING_LABEL, status: "Done", locked: true });
  later(() => {
    if (h?.page?.closed) return;
    h.page?.error?.(CLOSE_BY_HAND);
    h.finish({ label: RETURN_LABEL, status: "Done" });
  }, CLOSE_GRACE);
  return true;
}

// B123: signing.selfUpdate's states as they come (onState(state)) -> the last one, or null (an older shell without the
// call, or no self-update running)
export async function watchSelfUpdate(onState = () => {}, native) {
  let r;
  try { r = await bridge(native).call("signing.selfUpdate", {}, (ev) => { if (ev?.state) onState(ev.state); }); } catch { return null; }
  return r?.state ?? null;
}
