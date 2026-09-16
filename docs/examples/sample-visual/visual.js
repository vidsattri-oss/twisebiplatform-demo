/*
 * Minimal custom visual for the local Visuals import form.
 * It runs in the sandboxed visual frame and uses only the data supplied by BI.
 */
bi.registerVisual({
  render(root, data, api) {
    root.replaceChildren();
    root.style.cssText = 'box-sizing:border-box;padding:12px;font:12px system-ui;color:' + api.theme.text;

    if (!data.rows.length) {
      root.textContent = 'No data for the current filters.';
      return;
    }

    const max = Math.max(1, ...data.rows.map((row) => typeof row.values[0] === 'number' ? row.values[0] : 0));
    data.rows.forEach((row) => {
      const value = typeof row.values[0] === 'number' ? row.values[0] : 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.title = 'Select ' + (row.labels[0] || 'row');
      button.style.cssText = 'display:block;width:100%;margin:0 0 8px;padding:6px;border:0;background:transparent;text-align:left;color:inherit;cursor:pointer';

      const label = document.createElement('span');
      label.textContent = (row.labels[0] || 'Unlabelled') + '  ' + (row.formatted[0] || value);
      label.style.display = 'block';

      const track = document.createElement('span');
      track.style.cssText = 'display:block;height:8px;margin-top:4px;background:' + api.theme.grid + ';border-radius:4px;overflow:hidden';
      const bar = document.createElement('span');
      bar.style.cssText = 'display:block;height:100%;width:' + Math.max(0, Math.min(100, value / max * 100)) + '%;background:' + api.theme.primary + ';border-radius:4px';
      track.appendChild(bar);
      button.append(label, track);
      button.addEventListener('click', (event) => api.select(row.keys, event.ctrlKey || event.metaKey));
      button.addEventListener('contextmenu', (event) => { event.preventDefault(); api.seeRecords(row.keys); });
      root.appendChild(button);
    });
  },
});
