date: 2026-09-15
status: approved 2026-09-15 by product owner (Satya) — "Approve all"
decisions:
  - Excel: no new dependency. A dependency-free .xlsx reader (zip central directory + inflateRaw + sheet XML) lands sheets through the existing ingest path.
  - Add a second business SQLite database, appmaster.db, as the AppMasterDB stand-in carrying task_daily.daily_data / task_data JSON columns and FLAF/PO/PEG/SCR/MOC payloads (owner: "there must be two SQLite dbs, create one more if needed").
  - SQL Server / AppMasterDB and cloud databases: connector implemented against an optional driver (mssql loaded only if installed) and verified with contract tests on a mocked driver; UI shows "Needs SQL Server" until settings are entered.
  - Google Drive / Sheets: shared or published export links through the pull connector; OAuth later.
evidence: docs/spikes/twise-bi-requirements-v2.md
intent: docs/intent/twise-bi-requirements-v2.md
extends: docs/specs/twise-bi-module.md   # R1–R10 and invariants I1–I7 unchanged

requirements:
  # --- 1. Data sources -------------------------------------------------------
  S1 Connector types: >
    A connection has a type: sqlite, csv, excel, rest, googleSheet, sqlServer,
    postgres (cloud DB), sap. The Data sources page adds each type with its own
    form; the model layer is unchanged (every connector lands data the model can read).
  S2 File connectors: >
    CSV (existing RFC 4180 parser) and Excel (.xlsx, one table per sheet, typed
    columns) upload into an import database, with append/replace like JSON.
  S3 Pull connectors: >
    REST API (GET a JSON URL, optional bearer token stored encrypted, JSON path to
    the record list) and Google Sheets / Drive (published CSV or shared-file
    export link) pull on "Refresh now" and on a per-connection interval. Every pull
    runs through JSON/CSV ingest; last refresh time and row count are shown.
    Outbound hosts must be on BI_OUTBOUND_ALLOWED_HOSTS; private and link-local
    addresses are refused unless explicitly listed.
  S4 Database connectors: >
    SQL Server / AppMasterDB and Postgres-compatible cloud databases through a
    connector interface (test connection, list tables, run a compiled query) with
    encrypted credentials; SAP through OData. Where no reachable system exists the
    connection shows "Needs <system>" with the exact settings required.

  # --- 2. JSON flattening ----------------------------------------------------
  J1 Flatten a JSON column: >
    Pick a connection, table, JSON column and key column; the flattener writes
    child tables linked to the source row (task_daily.daily_data → task_daily__daily_data,
    lists → further child tables). Seed task_daily with daily_data and task_data
    JSON, and FLAF/PO/PEG/SCR/MOC payloads.
  J2 Key selection: >
    Optional list of key paths to extract (e.g. employee_ids, equipment_ids,
    metrics.actual_hours, metrics.actual_quantity, completed); preview shows what
    each produces.

  # --- 3. Formula editor -----------------------------------------------------
  F1 Logical: IF, SWITCH (value and SWITCH(TRUE(), …)), AND, OR, NOT, &&, ||, = <> < <= > >=, BLANK(), ISBLANK.
  F2 Text: & (concatenate), CONCATENATE, LEFT, RIGHT, MID, LEN, UPPER, LOWER, TRIM, FORMAT(number, "0.0%"), text measures.
  F3 Date: TODAY, NOW, DATE, YEAR, MONTH, DAY, WEEKDAY, DATEDIFF(start, end, DAY|MONTH|YEAR), EOMONTH.
  F4 Aggregation: existing plus SUMX / AVERAGEX / MINX / MAXX / COUNTX over the home table, COUNTBLANK.
  F5 Calculated columns: >
    Row-level expressions saved on a table (e.g. Delay Days = DATEDIFF(tasks[task_date], TODAY(), DAY),
    Status = IF(tasks[actual_quantity] >= tasks[planned_quantity], "Met", "Missed")),
    usable in axes, slicers, filters and measures like physical columns.
  F6 KPI logic: >
    Measures may return text or numbers (e.g. IF([Productivity %] >= 0.9, "On track", "At risk"));
    cards and the table visual show text results; the editor previews the result.

  # --- 4. Custom visuals -----------------------------------------------------
  V1 Plug-in package: >
    A plug-in is a manifest (type, label, icon, data roles, data kind) plus one
    JavaScript file implementing render(data, api) — the AppSource analogue.
  V2 Import and marketplace: >
    A Visuals page lists built-in, host-registered and imported visuals; authors
    import a package (.json manifest + .js) or install from the bundled catalog;
    imported visuals appear in the Visualizations pane immediately, per tenant.
  V3 Isolation: >
    Imported code runs in <iframe sandbox="allow-scripts"> (opaque origin, no
    access to host cookies, tokens or DOM); data arrives by postMessage and the
    plug-in can only send select / seeRecords messages back. Ships with two sample
    plug-ins (bullet chart, heat map).

  # --- 5. Filters ------------------------------------------------------------
  L1 Dataset filters: filters saved on a model, applied server-side to every query on that model, shown read-only in each report's filter pane.
  L2 Include / Exclude: right-click a data point → Include (keep only it) or Exclude (remove it) as visual-level filters, alongside See records.
  L3 Relative date: presets Today, Yesterday, Last 7 / 30 / 90 days; units day, week, month, quarter, year; include-today toggle.
  L4 Relative time: new datetime data type; last/next N minutes or hours relative to now.
  L5 Boolean: True / False / Blank toggle in filter cards and a boolean slicer style.
  L6 Blank / Not blank: one-click options in basic filter cards (advanced already supports them).
  L7 Default values: slicers store default selections; "Set current as default" in edit mode.
  L8 Single reset: "Reset to default" restores saved filters and slicer defaults and clears selection in one click.
  L9 Search, cascading, Top N/Bottom N, visual/page/report: already live — keep covered by tests.

  # --- 6. Cross filtering ----------------------------------------------------
  C1 Cross selection: table visual rows are selection sources (row click selects that row's first-column value; Ctrl adds).
  C2 Multi-select setting: report option "Multi-select without Ctrl"; slicer single-select option.
  C3 Cross filter, cross highlight, Ctrl multi-select, clear: already live — keep covered by tests.

  # --- Theme -----------------------------------------------------------------
  T1 Logo palette: blue #2841A3, orange #E38200, grey #59585D as default tokens, chart palette, grid theme; overridable via provideBi({ palette }) and host CSS variables.

invariants:
  I8: Imported visual code never executes in the host document's origin.
  I9: The backend makes outbound requests only to allow-listed hosts; credentials never leave the server.
  I10: Dataset filters apply to every query, rows and values request on their model and cannot be removed from a report.
  I11: Calculated columns and formula functions compile to SQL from parsed ASTs; text literals are bound parameters.

api_contract_changes:
  - Connection gains type, settings (non-secret), status, lastRefresh; POST /connections accepts typed settings; POST /connections/{id}/refresh; POST /connections/{id}/test.
  - POST /ingest/csv, POST /ingest/excel (multipart), POST /ingest/json-column.
  - Column gains expression (calculated) and dataType datetime; POST/DELETE /models/{id}/columns.
  - Measure result columns may be text: QueryRow.values: (number | string | null)[].
  - BiFilter gains relativeTime; relativeDate gains includeToday and week/quarter units.
  - GET/PUT /models/{id}/dataset-filters.
  - GET/POST/DELETE /visuals (plug-in manifests), GET /visuals/{id}/code.
  - ReportDefinition gains settings.multiSelectWithoutCtrl; slicer options gain defaultFilter.

security_concerns:
  - "Runtime plug-ins: sandboxed iframe without allow-same-origin; plug-in upload restricted to editors; manifest and code size capped."
  - "Outbound connectors: SSRF — host allow list, block private/link-local ranges, timeout and size caps, no redirects to non-allowed hosts."
  - "Credentials: encrypted with secrets.js (AES-256-GCM); CONNECTION_SECRET_KEY must be set for anything persistent."

rollout_plan:
  - Branch feature/twise-bi-requirements-v2 from feature/twise-bi-module.
  - Order: fix QA findings → theme → filters/cross-filter → formulas → JSON column flattening → connectors → plug-ins → E2E guide.
  - Each group lands with tests and a browser check before the next starts.
