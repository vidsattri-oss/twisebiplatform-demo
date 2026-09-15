date: 2026-09-15
mode: evidence
question: >
  What does a Power BI-like transform and modeling experience need in @tasnim/bi,
  can every transform step compile to SQLite SQL with bound values, and what
  already exists to build on?

prior_art:
  - v2 (feature/twise-bi-requirements-v2): dax.js row mode compiles IF / text /
    date formulas with bound literals — reusable for a Custom column step;
    ingest.js (ingestJson, flattenJsonColumn) lands tables; connectors refresh
    by replacing tables (a hook point for re-applying queries); Formulas page
    (admin entry) with validation and preview; model relationships from real
    foreign keys and overlay files only.
  - Reports home (report/src/report-list.component) is a flat card grid with no
    category, description, status, favorites or recent.
  - Data sources page (admin) renders connections, tables, dataset filters,
    relationships and measures fully expanded.
  - Entry-point lesson (CLAUDE.md): secondary entry points depend one way
    (admin → report → visuals/core). A formula editor inside the report editor
    therefore can't live in admin.
  - No negative results recorded for transforms; nothing was tried before.

outside_evidence:
  - https://learn.microsoft.com/en-us/power-bi/transform-model/ — hub lists
    Transform and shape data (Query editor, common query tasks, combine files),
    Model data (modeling view, relationships, many-to-many, data categorization,
    time-based calculations), Calculations (calculated columns, calculated tables,
    visual calculations, quick measures) and Self-service data prep (dataflows).
  - desktop-query-overview: Power Query Editor layout — Queries pane (left),
    data preview (centre, column context menus), Query Settings with Applied
    Steps (right; rename, delete, reorder), ribbon tabs Home / Transform /
    Add Column / View, Advanced Editor (M), Close & Apply loads the result.
  - desktop-common-query-tasks: group rows (count, sum, median, count distinct;
    advanced multi-key / multi-aggregation), pivot column with an aggregate,
    custom column formulas, remove columns / top or bottom rows, split columns,
    replace values; every action is a removable applied step.
  - TWise "Standard Charts" screen (product owner, 2026-09-15): All / Favorites /
    Recent tabs with counts, search, Category and Sort dropdowns, grid / list /
    compact toggle, collapsible category sections with "N Charts" pill, card
    carousel with arrows, cards with accent border, icon tile, Published badge,
    star, ⋮ menu, subtitle and "Updated 2d ago".

probes:
  - cmd: node:sqlite — SELECT k, ROW_NUMBER() OVER (ORDER BY k DESC)
    output: "3→1, 2→2, 1→3"   # index column, sort order, keep top N
  - cmd: node:sqlite — a RIGHT JOIN b / a FULL JOIN b
    output: "right: (2,2),(null,4); full: (1,null),(2,2),(3,null),(null,4)"   # merge queries all join kinds
  - cmd: node:sqlite — fill down via COUNT(v) OVER (ORDER BY ord) group + FIRST_VALUE
    output: "x, x, z"   # fill down without a JS row loop
  - cmd: node:sqlite — WITH RECURSIVE calendar from $from to $to (bound)
    output: "365 rows, 2026-01-01 … 2026-12-31"   # calendar table source
  - cmd: node:sqlite — CREATE TABLE t2 AS SELECT * FROM a WHERE v = $v; ALTER TABLE t2 RENAME TO "Crew Productivity"
    output: "1 row; rename ok"   # materialize with bound values, atomic swap, names with spaces

bars:
  - Preview (200 rows, up to 20 steps) p95 < 1 s on Wells (1,122 rows) and AppMasterDB (240 task_daily, 607 employee rows).
  - Apply (materialize) of a 20-step query over Wells < 2 s.
  - Kill criterion per step: a step that can't compile to SQLite SQL with bound values is dropped from scope, not implemented with a JavaScript row engine.
  - Unmeasurable here: TWise production data volumes; the .NET implementation compiles the same step JSON to T-SQL.

decision: proceed-full
