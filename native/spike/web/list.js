// Virtualised list: a fixed pool of absolutely positioned rows moved with transform, so a 30k-row list costs
// the same as a 30-row one. Rows are 44 pt (iOS table rows).
export const ROW_H = 44;

export function visibleRange(top, viewport, count, rowH = ROW_H, overscan = 8) {
  const first = Math.max(0, Math.floor(top / rowH) - overscan);
  const last = Math.min(count, Math.ceil((top + viewport) / rowH) + overscan);
  return [first, Math.max(first, last)];
}

const SECTIONS = ['Addons', 'Themes', 'Tweaks', 'Utilities', 'System', 'Development', 'Networking', 'Games'];

export function rowData(seed, i) {
  const n = (Math.imul(i + 1, 2654435761) ^ seed) >>> 0;
  return {
    name: `package-${seed % 97}-${i}`,
    desc: `${SECTIONS[n % SECTIONS.length]} • version 1.${n % 40}.${n % 7} • ${(n % 900) + 10} KB`,
  };
}

export class VirtualList {
  // scroller: an element with its own scrolling, or document.scrollingElement (then scroll events come from window)
  constructor(host, { count, seed, scroller, onTap }) {
    this.host = host;
    this.count = count;
    this.seed = seed;
    this.scroller = scroller;
    this.isDoc = scroller === document.scrollingElement;
    host.textContent = '';
    host.classList.add('vlist');
    host.style.height = `${count * ROW_H}px`;
    const size = Math.ceil(this.viewport() / ROW_H) + 2 * 8 + 2;
    this.pool = Array.from({ length: size }, () => {
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = '<b></b><small></small><i></i>';
      r.i = -1;
      host.append(r);
      return r;
    });
    this.onScroll = () => this.render();
    (this.isDoc ? window : scroller).addEventListener('scroll', this.onScroll, { passive: true });
    host.addEventListener('click', (e) => {
      const r = e.target.closest('.row');
      if (r && r.i >= 0) onTap?.(r.i);
    });
    this.render();
  }

  viewport() {
    return this.isDoc ? window.innerHeight : this.scroller.clientHeight || window.innerHeight;
  }

  render() {
    const [first, last] = visibleRange(this.scroller.scrollTop, this.viewport(), this.count);
    const size = this.pool.length;
    for (let i = first; i < last; i++) {
      const r = this.pool[i % size];
      if (r.i === i) continue;
      r.i = i;
      r.style.transform = `translate3d(0,${i * ROW_H}px,0)`;
      const d = rowData(this.seed, i);
      r.firstChild.textContent = d.name;
      r.children[1].textContent = d.desc;
    }
  }

  destroy() {
    (this.isDoc ? window : this.scroller).removeEventListener('scroll', this.onScroll);
    this.host.textContent = '';
  }
}
