// Spike A: one WKWebView, a JS navigation stack per tab, JS edge-swipe back that follows the finger.
// Push/pop animate transform only, through the Web Animations API (WebKit hands these to Core Animation).
// The swipe sets transform per frame from JS, so it runs at WebKit's requestAnimationFrame rate.
import { VirtualList, rowData } from './list.js';
import { setPhase, watchScroll, autoscroll } from './meter.js';
import { call } from './bridge.js';

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const DUR = 420;
const PARALLAX = 0.3;
const TABS = ['Sources', 'Changes', 'Search'];
const tabsEl = document.getElementById('tabs');
const tabbar = document.getElementById('tabbar');
const tabs = [];
let current = 0;
let busy = false;

const px = (x) => `translate3d(${x}px,0,0)`;
const width = () => tabsEl.clientWidth || innerWidth;

function anim(el, from, to, dur = DUR, easing = EASE) {
  const a = el.animate([{ transform: from }, { transform: to }], { duration: dur, easing, fill: 'forwards' });
  return a.finished.then(() => { el.style.transform = to; a.cancel(); });
}

function fade(el, from, to, dur = DUR, easing = EASE) {
  const a = el.animate([{ opacity: from }, { opacity: to }], { duration: dur, easing, fill: 'forwards' });
  return a.finished.then(() => { el.style.opacity = to; a.cancel(); });
}

function makeScreen(t, depth, title, seed) {
  const s = document.createElement('section');
  s.className = 'screen';
  s.innerHTML = `<header class="navbar"><span>${depth ? '<button class="back">Back</button>' : '<button class="exit">Exit</button>'}</span>
    <h1></h1><span><button class="auto">Auto</button></span></header><div class="content"><div></div></div>
    <div class="shade"></div>${depth ? '<div class="edge"></div>' : ''}`;
  s.querySelector('h1').textContent = title;
  const content = s.querySelector('.content');
  s.list = new VirtualList(content.firstChild, {
    count: depth ? 2000 : 30000, seed, scroller: content,
    onTap: (i) => push(t, rowData(seed, i).name, (seed * 31 + i) % 100000),
  });
  watchScroll(content);
  s.content = content;
  s.shade = s.querySelector('.shade');
  s.querySelector('.back')?.addEventListener('click', () => pop(t));
  s.querySelector('.exit')?.addEventListener('click', () => call('app.exit'));
  s.querySelector('.auto').addEventListener('click', () => auto(t));
  const edge = s.querySelector('.edge');
  if (edge) swipe(t, s, edge);
  return s;
}

async function push(t, title, seed) {
  if (busy) return;
  busy = true;
  const st = tabs[t].stack;
  const below = st.at(-1);
  const top = makeScreen(t, st.length, title, seed);
  top.style.transform = px(width());
  tabs[t].el.append(top);
  st.push(top);
  setPhase('push');
  const w = width();
  await Promise.all([anim(top, px(w), px(0)), anim(below, px(0), px(-PARALLAX * w)), fade(below.shade, 0, 0.12)]);
  below.style.visibility = 'hidden';
  setPhase('idle');
  busy = false;
}

async function pop(t) {
  const st = tabs[t].stack;
  if (busy || st.length < 2) return;
  busy = true;
  const top = st.pop();
  const below = st.at(-1);
  below.style.visibility = '';
  setPhase('pop');
  const w = width();
  await Promise.all([anim(top, px(0), px(w)), anim(below, px(-PARALLAX * w), px(0)), fade(below.shade, 0.12, 0)]);
  top.list.destroy();
  top.remove();
  setPhase('idle');
  busy = false;
}

// Interactive back: a 24 pt edge strip takes the pointer; the screen follows it, written once per frame.
function swipe(t, top, edge) {
  let x0 = 0, dx = 0, w = 0, below = null, pending = false, hist = [];
  const write = () => {
    pending = false;
    top.style.transform = px(dx);
    below.style.transform = px(-PARALLAX * (w - dx));
    below.shade.style.opacity = 0.12 * (1 - dx / w);
  };
  edge.addEventListener('pointerdown', (e) => {
    const st = tabs[t].stack;
    if (busy || st.at(-1) !== top) return;
    busy = true;
    try { edge.setPointerCapture(e.pointerId); } catch { /* synthetic pointer (trace) */ }
    x0 = e.clientX; dx = 0; w = width(); hist = [[e.timeStamp, 0]];
    below = st.at(-2);
    below.style.visibility = '';
    setPhase('swipe');
  });
  edge.addEventListener('pointermove', (e) => {
    if (!below) return;
    const co = e.getCoalescedEvents?.();
    for (const ev of co?.length ? co : [e]) hist.push([ev.timeStamp, Math.max(0, ev.clientX - x0)]);
    dx = hist.at(-1)[1];
    if (hist.length > 12) hist.splice(0, hist.length - 12);
    if (!pending) { pending = true; requestAnimationFrame(write); }
  });
  const end = async () => {
    if (!below) return;
    const b = below;
    below = null;
    const recent = hist.filter(([ts]) => ts > hist.at(-1)[0] - 80);
    const [t0, x1] = recent[0];
    const v = (dx - x1) / Math.max(1, hist.at(-1)[0] - t0); // pt/ms
    const done = dx > w / 2 || v > 0.4;
    const rest = done ? w - dx : dx;
    const dur = Math.min(350, Math.max(120, rest / Math.max(Math.abs(v), w / DUR)));
    const ease = 'cubic-bezier(0.25, 0.6, 0.35, 1)';
    if (done) {
      await Promise.all([anim(top, px(dx), px(w), dur, ease), anim(b, px(-PARALLAX * (w - dx)), px(0), dur, ease),
        fade(b.shade, 0.12 * (1 - dx / w), 0, dur, ease)]);
      tabs[t].stack.pop();
      top.list.destroy();
      top.remove();
    } else {
      await Promise.all([anim(top, px(dx), px(0), dur, ease), anim(b, px(-PARALLAX * (w - dx)), px(-PARALLAX * w), dur, ease),
        fade(b.shade, 0.12 * (1 - dx / w), 0.12, dur, ease)]);
      b.style.visibility = 'hidden';
    }
    setPhase('idle');
    busy = false;
  };
  edge.addEventListener('pointerup', end);
  edge.addEventListener('pointercancel', end);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Scripted run: 10 pushes, 10 pops, then 3 s of JS fast scroll on the root list.
async function auto(t) {
  if (busy) return;
  for (let i = 0; i < 10; i++) { await push(t, `Auto ${i + 1}`, 1000 + i); await wait(250); }
  for (let i = 0; i < 10; i++) { await pop(t); await wait(250); }
  await autoscroll(tabs[t].stack[0].content);
  call('app.autoDone', { spike: 'A' });
}

TABS.forEach((name, t) => {
  const el = document.createElement('div');
  el.className = 'tab';
  el.hidden = t !== 0;
  tabsEl.append(el);
  const root = makeScreen(t, 0, name, t + 1);
  el.append(root);
  tabs.push({ el, stack: [root] });
  const b = document.createElement('button');
  b.textContent = name;
  b.className = t === 0 ? 'on' : '';
  b.addEventListener('click', () => {
    if (busy) return;
    tabs[current].el.hidden = true;
    tabbar.children[current].className = '';
    current = t;
    tabs[t].el.hidden = false;
    b.className = 'on';
  });
  tabbar.append(b);
});
window.spike = { auto: () => auto(current), push: (title) => push(current, title, 5), pop: () => pop(current) };
call('page.ready', { spike: 'A' });
