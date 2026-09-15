date: 2026-09-15
mode: evidence
question: >
  Which of the product owner's detailed sub-features are already delivered by
  the TWise BI module, and what does closing each gap need on this machine?

prior_art:
  - docs/spikes/twise-bi-module.md and the build on feature/twise-bi-module
    (backend 56/56, library 30/30, harness 5/5, browser-verified).
  - Independent QA found 6 medium/low issues (code-review, 2026-09-15); fix before
    or with this work.

probes:
  - cmd: docker --version
    output: "command not found"   # no local SQL Server / cloud DB containers
  - cmd: npm view exceljs version / dependencies / dist.unpackedSize
    output: "4.4.0 · deps tmp, uuid, dayjs, jszip, saxes, archiver, fast-csv, unzipper, readable-stream… · 21.8 MB unpacked"
  - cmd: npm view mssql version / tedious
    output: "mssql 12.7.2 (tedious 19/20) — installable, but no server to connect to"
  - cmd: node -e "fetch('http://localhost:4173/api/bi/models')"
    output: "fetch ok, models: 4"   # built-in fetch available for REST/Sheets pulls
  - cmd: sqlite_master scan of data.db for JSON-bearing tables
    output: "raw_events(payload_json) only — no task_daily / task_data tables with JSON columns to flatten"

gap_matrix:
  # status: live | partial | missing ; evidence = where it exists today
  data_sources:
    SQL Server / AppMasterDB: missing   # SQLite stand-in only; contract ready for .NET API
    Excel: missing
    CSV: partial                       # bi/csv.js parser used by seed only; no upload
    Google Drive: missing
    Google Sheets: missing
    REST API: missing
    JSON files: live                   # /api/bi/ingest/json, JSON import page
    Cloud databases: missing
    SAP / ERP: missing                 # placeholder card
    Future integrations: partial       # one model per connection; no connector type registry
  json_flattening:
    Flatten JSON stored in a DB column (task_daily.daily_data, task_data, FLAF/PO/PEG/SCR/MOC): missing
    Extract named keys (employee_ids, equipment_ids, actual_hours, actual_quantity, completed): partial   # all keys flattened; no key selection
  formula_editor:
    Report-level logic without touching the database: live   # bi_measures
    IF / CASE (SWITCH): missing
    Arithmetic: live
    Text functions: missing
    Date functions: missing
    Aggregation formulas: live        # SUM, AVERAGE, MIN, MAX, COUNT, DISTINCTCOUNT, COUNTROWS, DIVIDE
    KPI logic (thresholds, status): partial   # ratios only; no conditional or text results
    Calculated columns: missing
  custom_visuals:
    Build custom visual (developer, provideBiVisual): live
    Import plug-in at runtime (AppSource-like marketplace): missing
  filters:
    Visual: live
    Page: live
    Report: live
    Dataset (data-source level): missing
    Include: partial                  # basic "in"; no Include action on a data point
    Exclude: partial                  # basic "notIn"; no Exclude action on a data point
    Top N: live
    Bottom N: live
    Relative Date (Today / Yesterday / Last 30 days): partial   # last/this/next N day|month|year; no Today/Yesterday presets, week/quarter, or include-today
    Relative Time: missing            # no datetime type
    Blank / Not blank: live           # advanced isBlank / isNotBlank
    Boolean: partial                  # True/False appear as values; no boolean toggle
    Search inside filters: live
    Default filter values: partial    # saved filters yes; slicer defaults no
    Cascading filters: live           # slicers narrow each other
    Single reset button: partial      # "Reset slicers" only
  cross_filtering:
    Cross Filter: live
    Cross Highlight: live
    Cross Selection: partial          # charts only; table rows not selectable
    Multi-select: partial             # Ctrl only; no multi-select-without-Ctrl option
    Ctrl Multi-select: live
    Clear Filters: live               # "Clear selection"

bars:
  - Every "missing" or "partial" row becomes live with an automated test, or is
    labelled "needs <system>" only if it requires SQL Server, a cloud database,
    SAP, or Google OAuth that this machine cannot reach.
  - Wells parity vectors and I1–I7 tests stay green.
  - Kill: if a sandboxed iframe cannot render a plug-in visual and return
    selections via postMessage, runtime import stops and returns to intent.

decision: proceed-full   # new public contract surface (connectors, formulas, plug-ins), outbound HTTP and third-party code
blockers_for_human:
  - exceljs dependency approval.
  - SQL Server / AppMasterDB verification route.
  - Google Drive / Sheets approach.
