// Spike B: one screen per pooled WKWebView. UINavigationController animates and swipes natively; the page only
// draws its list. show() re-targets a recycled view without reloading it.
import { VirtualList, rowData } from './list.js';
import { watchScroll, autoscroll } from './meter.js';
import { call } from './bridge.js';

const host = document.getElementById('list');
let list = null;
let seed = 1;
watchScroll(window);

function show({ seed: s, depth }) {
  list?.destroy();
  seed = s;
  scrollTo(0, 0);
  list = new VirtualList(host, {
    count: depth ? 2000 : 30000, seed, scroller: document.scrollingElement,
    onTap: (i) => call('nav.push', { title: rowData(seed, i).name, seed: (seed * 31 + i) % 100000 }),
  });
}

window.spike = { show, autoscroll: () => autoscroll(document.scrollingElement) };
if (window.__pending) show(window.__pending);
call('page.ready', { spike: 'B' });
