// Per-page state for a screen whose page can be on screen more than once: a tab's root is also pushed on Home
// (router.js rootOn), so Sources, Changes and Installed can each have two live copies of the same page. Module
// variables would follow whichever copy was drawn last; instead each page body gets a view object of its own, and
// whatever reloads (a catalog change, a refresh) draws every live view.
//
//   const views = pageViews(() => ({ query: "" }));
//   const v = views.open(body);   // the body's view (made once; a second render of the same body keeps it)
//   views.all();                  // the live views, oldest first
//   views.of(body);               // the body's view, or null
//
// A view is dropped once its body has been on screen and is not any more (its page was popped or rebuilt). A body
// never attached (a node test's stub) counts as live.
export function pageViews(make) {
  const byBody = new Map(); // body -> view

  const gone = (v) => {
    const c = v.body?.isConnected;
    if (c) v.seen = true;
    return v.seen && c === false;
  };

  return {
    open(body, init = {}) {
      const v = byBody.get(body) ?? this.adopt(body, make());
      Object.assign(v, init);
      return v;
    },
    // Makes `view` (an object made earlier, e.g. by the screen's nav() for the same page) the body's view, in place of
    // any it had.
    adopt(body, view) {
      Object.assign(view, { body, seen: false });
      byBody.set(body, view);
      gone(view); // marks it seen when the body is already in the document
      return view;
    },
    of: (body) => (body && byBody.get(body)) || null,
    all() {
      const out = [];
      for (const [body, v] of byBody) {
        if (gone(v)) byBody.delete(body);
        else out.push(v);
      }
      return out;
    },
    // Forget every view (tests).
    clear() { byBody.clear(); },
  };
}
