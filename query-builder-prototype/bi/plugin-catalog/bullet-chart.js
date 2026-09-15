/*
 * Bullet chart — a sample Tasnim BI plug-in.
 * Fields: Category (one field) and Values (the actual, then an optional target).
 *
 * The sandboxed frame calls render(root, data, api) whenever the data, the
 * selection or the size changes:
 *   data.categories   field names, e.g. ["name"]
 *   data.measures     [{ name, format }]
 *   data.rows         [{ keys, labels, values, formatted, highlights }]
 *   data.highlighted  true when another visual's selection highlights this one
 *   data.selected     category values selected in this visual
 *   api.theme         { palette, primary, accent, text, muted, grid, surface }
 *   api.select(keys, additive)  cross-filters the other visuals
 *   api.seeRecords(keys)        opens See records for a data point
 */
bi.registerVisual({
  render(root, data, api) {
    const NS = 'http://www.w3.org/2000/svg';
    const t = api.theme;
    root.replaceChildren();
    if (!data.rows.length) {
      root.textContent = 'No data for the current filters.';
      return;
    }

    const width = Math.max(root.clientWidth, 240);
    const rowHeight = 34;
    const labelWidth = Math.min(170, Math.round(width * 0.3));
    const valueWidth = 96;
    const plotWidth = Math.max(40, width - labelWidth - valueWidth - 12);
    const hasTarget = data.measures.length > 1;
    const height = data.rows.length * rowHeight + (hasTarget ? 30 : 10);
    const numbers = data.rows.flatMap((r) => r.values.filter((v) => typeof v === 'number'));
    const max = Math.max(1, ...numbers) * 1.08;
    const x = (v) => (typeof v === 'number' ? (Math.max(0, v) / max) * plotWidth : 0);

    const node = (name, attrs, parent) => {
      const el = document.createElementNS(NS, name);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
      parent.appendChild(el);
      return el;
    };
    const svg = node('svg', { width, height, role: 'img', 'aria-label': `${data.measures.map((m) => m.name).join(' against ')} by ${data.categories.join(', ')}` }, root);

    data.rows.forEach((row, i) => {
      const selected = data.selected.includes(row.keys[0]);
      const faded = (data.highlighted && !(row.highlights && row.highlights[0])) || (data.selected.length > 0 && !selected);
      const g = node('g', { transform: `translate(0 ${i * rowHeight + 4})`, style: 'cursor:pointer', opacity: faded ? 0.4 : 1 }, svg);

      const label = node('text', { x: labelWidth - 8, y: 17, 'text-anchor': 'end', 'font-size': 12, fill: selected ? t.accent : t.text, 'font-weight': selected ? 600 : 400 }, g);
      label.textContent = row.labels[0] ?? '';
      node('rect', { x: labelWidth, y: 3, width: plotWidth, height: 20, rx: 3, fill: t.grid, opacity: 0.5 }, g);
      node('rect', { x: labelWidth, y: 8, width: x(row.values[0]), height: 10, rx: 2, fill: t.primary }, g);
      if (data.highlighted && row.highlights && typeof row.highlights[0] === 'number') {
        node('rect', { x: labelWidth, y: 8, width: x(row.highlights[0]), height: 10, rx: 2, fill: t.accent }, g);
      }
      if (hasTarget && typeof row.values[1] === 'number') {
        node('rect', { x: labelWidth + x(row.values[1]) - 1.5, y: 1, width: 3, height: 24, rx: 1, fill: t.accent }, g);
      }
      const value = node('text', { x: labelWidth + plotWidth + 8, y: 17, 'font-size': 12, fill: t.muted }, g);
      value.textContent = hasTarget ? `${row.formatted[0]} / ${row.formatted[1]}` : row.formatted[0];
      node('title', {}, g).textContent = `${row.labels.join(', ')} — ${data.measures.map((m, j) => `${m.name}: ${row.formatted[j]}`).join(', ')}`;

      g.addEventListener('click', (event) => api.select(row.keys, event.ctrlKey || event.metaKey));
      g.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        api.seeRecords(row.keys);
      });
    });

    if (hasTarget) {
      const legend = node('g', { transform: `translate(${labelWidth} ${height - 8})`, 'font-size': 11, fill: t.muted }, svg);
      node('rect', { x: 0, y: -9, width: 14, height: 9, rx: 2, fill: t.primary }, legend);
      node('text', { x: 20, y: 0 }, legend).textContent = data.measures[0].name;
      node('rect', { x: 150, y: -11, width: 3, height: 13, fill: t.accent }, legend);
      node('text', { x: 158, y: 0 }, legend).textContent = data.measures[1].name;
    }
  },
});
