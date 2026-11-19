window.__cert = (lvl, title, sub) => {
  if (!document.getElementById('cc')) { const st = document.createElement('style'); st.id = 'cc'; st.textContent = `
.home-row.cert { margin-bottom: 12px; }
.home-row.cert > .table { background: var(--cert-bg); border-color: var(--cert-edge); }
.home-row.cert .home-glyph { background-color: var(--cert-ink); }
.home-row.cert .cell-subtitle { color: var(--cert-ink); font-weight: bold; }
.home-row.cert.soon  { --cert-bg: #fff6e0; --cert-edge: #e0b65a; --cert-ink: #d98a00; }
.home-row.cert.close { --cert-bg: #ffe9e6; --cert-edge: #e08a80; --cert-ink: #d1281b; }
.home-row.cert.gone > .table { background: linear-gradient(#e4473b, #c4261b); border-color: #a01c13; }
.home-row.cert.gone .cell-label, .home-row.cert.gone .cell-subtitle { color: #fff; text-shadow: 0 -1px 0 rgba(0,0,0,.35); }
.home-row.cert.gone .home-glyph { background-color: #8f1a12; }
.home-row.cert.gone .chevron::after { filter: brightness(10); }`; document.head.append(st); }
  document.querySelector('.home-row.cert')?.remove();
  const d = document.createElement('div');
  d.className = 'home-row stack cert ' + lvl;
  d.innerHTML = `<ul class="table grouped home-tiles home-stack"><li class="cell"><a class="cell-inner chevron home-tile" href="#/home/settings/signing"><span class="cell-icon home-glyph glyph-failed"></span><span class="home-tile-text"><span class="cell-label">${title}</span><span class="cell-subtitle">${sub}</span></span></a></li></ul>`;
  document.querySelector('.home-head').after(d);
  return 'ok';
};
'ready'
