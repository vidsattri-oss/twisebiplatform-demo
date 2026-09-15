/*
 * Heat map — a sample Tasnim BI plug-in.
 * Fields: Rows, then columns (one or two category fields) and one Value.
 * See bullet-chart.js for the render(root, data, api) contract.
 */
bi.registerVisual({
  render(root, data, api) {
    const t = api.theme;
    root.replaceChildren();
    if (!data.rows.length) {
      root.textContent = 'No data for the current filters.';
      return;
    }

    const twoFields = data.categories.length > 1;
    const rowLabels = [];
    const columnLabels = [];
    const cells = new Map();
    for (const row of data.rows) {
      const rowLabel = row.labels[0];
      const columnLabel = twoFields ? row.labels[1] : data.measures[0].name;
      if (!rowLabels.includes(rowLabel)) rowLabels.push(rowLabel);
      if (!columnLabels.includes(columnLabel)) columnLabels.push(columnLabel);
      cells.set(JSON.stringify([rowLabel, columnLabel]), row);
    }

    const numbers = data.rows.map((r) => r.values[0]).filter((v) => typeof v === 'number');
    const min = Math.min(0, ...numbers);
    const max = Math.max(1, ...numbers);
    const share = (v) => (max === min ? 1 : (v - min) / (max - min));

    const grid = document.createElement('div');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', `${data.measures[0].name} by ${data.categories.join(' and ')}`);
    grid.style.cssText = `display:grid;grid-template-columns:minmax(72px,max-content) repeat(${columnLabels.length},minmax(58px,1fr));gap:3px;padding:4px;font-size:12px;color:${t.text}`;
    const header = (textValue, extra) => {
      const el = document.createElement('div');
      el.textContent = textValue;
      el.style.cssText = `font-weight:600;color:${t.muted};padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${extra}`;
      grid.appendChild(el);
    };

    header('', '');
    columnLabels.forEach((label) => header(label, 'text-align:center'));
    rowLabels.forEach((rowLabel) => {
      const rowKey = data.rows.find((r) => r.labels[0] === rowLabel)?.keys[0];
      header(rowLabel, `text-align:right;color:${data.selected.includes(rowKey) ? t.accent : t.muted}`);
      columnLabels.forEach((columnLabel) => {
        const row = cells.get(JSON.stringify([rowLabel, columnLabel]));
        const value = row && typeof row.values[0] === 'number' ? row.values[0] : null;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.textContent = row ? row.formatted[0] : '';
        cell.title = row ? `${row.labels.join(' · ')}: ${row.formatted[0]}` : '';
        const p = value === null ? 0 : share(value);
        const faded = row && ((data.highlighted && !(row.highlights && row.highlights[0])) || (data.selected.length > 0 && !data.selected.includes(row.keys[0])));
        cell.style.cssText = [
          'border:0',
          'border-radius:4px',
          'padding:9px 4px',
          'font:inherit',
          'font-variant-numeric:tabular-nums',
          `cursor:${row ? 'pointer' : 'default'}`,
          `background:${value === null ? 'transparent' : `color-mix(in srgb, ${t.primary} ${Math.round(10 + p * 90)}%, ${t.surface})`}`,
          `color:${p > 0.5 ? '#FFFFFF' : t.text}`,
          `opacity:${faded ? 0.35 : 1}`,
        ].join(';');
        if (row) {
          cell.addEventListener('click', (event) => api.select(row.keys, event.ctrlKey || event.metaKey));
          cell.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            api.seeRecords(row.keys);
          });
        }
        grid.appendChild(cell);
      });
    });
    root.appendChild(grid);
  },
});
