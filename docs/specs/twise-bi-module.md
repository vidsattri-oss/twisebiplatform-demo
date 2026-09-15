date: 2026-09-14
status: approved 2026-09-14 by product owner (Satya) — "implementing these features is of high importance, with the ability to plug this into the main code"
decisions:
  - Angular 22 target; owner upgrades Node to >= 24.15 (backend work proceeds first on the current Node).
  - Node reference implementation of /api/bi now; .NET port later against the same contract tests.
  - Wells CSV kept out of git; seeded from WELLS_CSV into a gitignored wells.db.
evidence: docs/spikes/twise-bi-module.md
intent: docs/intent/twise-bi-module.md

requirements:
  R1 Pluggable library: >
    `@tasnim/bi` exports provideBi(config), BI_ROUTES and <bi-report>. It has no
    global styles and no imports from any app. Theming uses CSS custom properties
    that default to TWise tokens (Inter, #21409A, #DCE3ED, radius 10/12).
  R2 Data-source seam: >
    All data access goes through the BI_DATA_SOURCE injection token. The library
    ships HttpBiDataSource for the /api/bi contract; TWise can swap in its own.
  R3 Semantic model (feature 01): >
    A model is tables, typed columns, sort-by columns, hidden flags,
    relationships and measures. It is defined as reviewable JSON (PBIP-style
    "model as code") over a registered connection. Adding a model needs no code
    change.
  R4 JSON ingestion (feature 02): >
    Records become columns and lists become child-table rows keyed to their
    parent, with a relationship created automatically (Power Query
    expand-record / expand-list). Ingestion runs server-side and the UI
    previews the result.
  R5 Measures (feature 03): >
    Measures are written in a DAX subset — COUNTROWS, SUM, AVERAGE, MIN, MAX,
    DISTINCTCOUNT, DIVIDE, + - * /, numeric literals, [Measure] references. They
    are parsed and compiled to SQL on the server and evaluated per group in the
    visual's filter context. The editor validates through the server and shows
    positioned errors. Never eval.
  R6 Visual registry (feature 04): >
    Each entry is {type, label, dataRoles, capabilities, loadComponent}.
    Built-ins are column, bar, line, pie, donut (Highcharts), table (AG Grid) and
    card. A host adds a custom visual with provideBiVisual() and no library
    rebuild; the harness demonstrates this with one custom visual.
  R7 Filters (feature 05): >
    A typed union — basic (in / not in), advanced (comparison), range (between),
    relativeDate (last N days / months / years), topN (by measure). Each filter
    has a scope: report, page or visual. A filter pane shows every scope, and
    each visual shows the filters affecting it.
  R8 Cross-filter / highlight (feature 06): >
    The selection is a set of {table, column, values}; Ctrl/Cmd-click adds
    values. Each visual has an interaction mode: highlight (default for
    column/bar/line/pie/donut), filter (default for table and card), or none. The
    source visual is never filtered by its own selection. Selection propagates
    across relationships from the one side to the many side (Power BI default
    single direction).
  R9 See records and drill: >
    See records returns paged detail rows under the full filter context plus the
    data point, with a total count, shown in AG Grid in a side sheet. It opens by
    right-click or keyboard. Date group-by supports Year > Quarter > Month drill
    with a breadcrumb.
  R10 Report editing: >
    Reports are pages of visuals. "Add visual" and "Edit visual" open an in-place
    Visualizations pane (type picker, data-role wells filled from the model field
    list, visual filters) — the Power BI pattern, replacing navigation to a
    separate query builder.

invariants:
  I1: Every identifier in generated SQL is resolved from model metadata; no client string reaches SQL text.
  I2: Every filter value is a bound parameter of the column's declared type.
  I3: A visual's query and its See records use the same filter context (report ∪ page ∪ visual ∪ applicable selection) — one function builds both.
  I4: A visual is never filtered by a selection it originated.
  I5: The library imports nothing from the harness; host-specific behaviour lives only behind injection tokens.
  I6: The Wells acceptance vectors in the intent reproduce exactly.
  I7: For each visual, only the latest request's response renders; superseded requests are cancelled.

constraints:
  - Angular 22.x, TypeScript per Angular 22 peer range, Node 24.
  - Highcharts 13.x + highcharts-angular 5.x; ag-grid-community/ag-grid-angular 36.x.
  - Query latency p95 < 300 ms for the 1,122-row Wells model locally.
  - See records page size 100, max 1000 per request; the total count is always returned.
  - Relative-date filters evaluate against a server-supplied "today" so tests are deterministic.

architecture:
  frontend: >
    New Angular 22 workspace `twise-bi/` with projects/tasnim-bi (library,
    satisfies R1) and projects/host-harness (a TWise-like shell that consumes the
    library exactly as TWise would; proves I5).
    Library entry points:
      core     — models, filter types, BI_DATA_SOURCE, ReportStore
                 (signals; context building for I3/I4), visual registry (R2, R6-R8)
      visuals  — Highcharts and AG Grid wrappers (R6)
      report   — <bi-report>, filter pane, Visualizations pane, See records
                 sheet, drill breadcrumb (R7-R10)
      admin    — data sources, model browser, JSON import, measure editor
                 (R3-R5), optional routes
      http     — HttpBiDataSource
  backend: >
    New module `query-builder-prototype/bi/` mounted at /api/bi, added beside
    the existing routes so the old app keeps working. Components:
      model-registry  — loads models/*.json and validates them against live
                        schema (R3, I1)
      dax             — tokenizer, parser and SQL compiler for the R5 subset (R5, I1)
      query-compiler  — VisualQuery to SQL with highlight CASE aggregates,
                        relationship propagation, sort-by, top N and relative
                        dates (R7-R9, I1-I4)
      ingest          — JSON records/lists to parent and child tables (R4)
      reports store   — report JSON persistence (R10)
    The .NET tenant API implements the same OpenAPI contract later; the Node
    module is the reference implementation, and the contract tests run against
    whichever implementation is behind the URL.

api_contracts:
  file: docs/api/bi-contract.openapi.yaml (written in build step 2)
  endpoints:
    - GET  /api/bi/models                       -> ModelSummary[]
    - GET  /api/bi/models/{modelId}             -> SemanticModel
    - POST /api/bi/query                        -> {columns, rows}  (VisualQuery; rows carry value and highlight per measure)
    - POST /api/bi/rows                         -> {columns, rows, total}  (See records)
    - POST /api/bi/values                       -> {values, truncated}  (slicer values under context)
    - POST /api/bi/measures/validate            -> {ok, sql?, error?: {message, position}}
    - GET/POST/PUT/DELETE /api/bi/reports[/{id}]
    - GET  /api/bi/connections ; POST /api/bi/ingest/json
  highlight_semantics: >
    Aggregates compile as AGG(CASE WHEN <selection predicate> THEN expr END).
    `value` is computed without the selection and `highlight` with it, in one
    scan. For the source visual only the selected category is non-null, which
    renders as highlight-on-selection and dim-others.

data_model_changes:
  - New metadata table `bi_reports(id, name, definition_json, created_at, updated_at)` in data.db.
  - New `models/*.json` files (in git).
  - `connections/wells.db`, built from the Wells CSV by `npm run seed:wells`; gitignored (*.db), with the CSV path supplied via WELLS_CSV.
  - Existing tables untouched.

rollout_plan:
  - Build in new folder `twise-bi/` and new backend module `bi/`; the old angular-bi and its routes stay working.
  - Delivered on branch `feature/twise-bi-module` as commits per build step; a human merges.
  - Rollback: delete the folder and unmount /api/bi (one line).
  - At the outcome review (2026-10-14), decide whether to delete angular-bi.

security_concerns:
  - "No authentication in the reference backend. The contract declares bearerAuth and a row-filter hook; enforcing it is the tenant API's job. Owner: TWise .NET team."
  - "TWise tenant API returned category data without an Authorization header (review finding). Owner: TWise API team."
  - "Ingest creates tables from client data. Names are sanitised and prefixed, the body is size-capped, and it writes only to an ingest connection, never the metadata DB."

compliance_flags:
  - Highcharts is commercially licensed — confirm TWise's licence covers this module. Owner: TWise product owner.
  - The Wells CSV appears to be real PDO well data — keep it out of git unless the data owner approves. Owner: data owner.
