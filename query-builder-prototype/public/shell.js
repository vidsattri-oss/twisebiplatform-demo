function renderShell(active, crumb) {
  const icon = {
    grid: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
    fx: '<svg width="17" height="17" viewBox="0 0 24 24"><text x="1" y="17" font-family="IBM Plex Mono" font-size="14" font-weight="700" fill="currentColor">ƒx</text></svg>',
  };

  document.getElementById('shell-root').innerHTML = `
    <div class="shell">
      <div class="sidebar">
        <div class="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none"><path d="M4 9 L16 5 L28 9 L16 13 Z" fill="#F5811F"/><path d="M16 13 L16 27 M8 17 L24 17" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>
          <div><div class="brand-title">AL TASNIM</div><div class="brand-sub">Query Builder Prototype</div></div>
        </div>
        <nav class="nav">
          <a class="nav-item ${active === 'sources' ? 'active' : ''}" href="/sources.html">${icon.grid} Data Sources</a>
          <a class="nav-item ${active === 'builder' ? 'active' : ''}" href="/query-builder.html">${icon.fx} Query Builder</a>
        </nav>
        <div class="sidebar-note"><b>Local prototype</b><br>Real Express + SQLite backend on this machine, proving the metadata-validation pattern from the feasibility study &mdash; not a hosted demo.</div>
      </div>
      <div class="main-col">
        <div class="topbar">
          <div class="crumb">${crumb}</div>
          <div class="spacer"></div>
          <div class="status-pill" id="conn-pill"><span class="status-dot warn"></span><span>Checking connection&hellip;</span></div>
        </div>
        <div class="content" id="page-content"></div>
      </div>
    </div>
  `;

  fetch('/api/health').then((r) => r.json()).then(() => {
    document.getElementById('conn-pill').innerHTML = '<span class="status-dot"></span><span>SQLite connected</span>';
  }).catch(() => {
    document.getElementById('conn-pill').innerHTML = '<span class="status-dot warn"></span><span>Backend unreachable</span>';
  });
}
