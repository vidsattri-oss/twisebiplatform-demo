date: 2026-09-15
status: approved 2026-09-15 by product owner (Satya) — "Approve all"
decisions:
  - Query output is a materialized table (Import mode), re-applied after its source refreshes.
  - Transform data opens full-screen over the report editor; also available as its own page.
  - Favorites / recent: the library keeps a replaceable per-browser service as its default (option 1);
    server-side per-user storage is the recommended production path (option 2, TWise user API).
    For the demo, option 2 runs as a separate local preferences server (own port and store,
    demo user id header), which the harness wires in the way TWise would wire its user service.
evidence: docs/spikes/twise-bi-modeling-v3.md
intent: docs/intent/twise-bi-modeling-v3.md
extends: docs/specs/twise-bi-requirements-v2.md   # R1–R10, S/J/F/V/L/C/T and I1–I11 unchanged

requirements:
  # --- Data sources layout ---------------------------------------------------
  D1 Collapsible data sources: >
    The Connections panel collapses to a slim rail; the model's Tables, Dataset
    filters, Relationships and Measures sections each collapse with a count in
    the header; tables stay individually expandable. Choices are remembered per
    browser.

  # --- Reports home (TWise Standard Charts pattern) --------------------------
  R1 Reports home: >
    Header with icon, title and subtitle; tabs All / Favorites / Recent with
    counts; search (name, description); Category filter; Sort (Name A–Z, Name
    Z–A, Recently updated, Recently opened); view toggle grid / list / compact.
    Reports are grouped in collapsible category sections (icon, name,
    description, "N Reports" pill, chevron). Grid view shows a card row with
    previous / next arrows; list and compact views show rows. Cards: category
    accent border and icon tile, Published / Draft badge, favorite star, ⋮ menu
    (Open, Edit, Duplicate, Rename, Move to category, Publish / Unpublish,
    Delete), title, description, a glyph of the report's visual types, data
    source and "Updated 2d ago".
  R2 Report metadata: >
    Reports gain category, description and status (draft | published).
    Categories have a name, description, accent colour and order; "Uncategorised"
    is implicit. New reports start as drafts in the chosen category.
  R3 Favorites and recent: >
    BI_REPORT_PREFERENCES (favorites, recently opened) with a default per-browser
    implementation and an HTTP implementation for a per-user preferences service.
    Opening a report records it as recent (last 10). The demo runs a separate
    local preferences server (preferences-server/, port 4175, file-backed, keyed
    by a demo user id) that the harness uses; TWise points the same HTTP
    implementation, or its own, at its user API.

  # --- Modeling inside the report editor ------------------------------------
  E1 Data pane: >
    In edit mode the left side has tabs Visualizations | Data. Data lists the
    model's tables (searchable, collapsible) with columns and measures, badges
    for calculated columns and query tables; clicking a field adds it to the
    focused visual's first open role. "New measure" and "New column" open the
    formula editor in the pane; "Transform data" opens the Transform editor.
    Saving reloads the model in the open report without losing unsaved edits.
  E2 Reusable formula editor: >
    The formula editor (validation, function reference, preview, save) is one
    component in a new @tasnim/bi/modeling entry point, used by the Data pane and
    the Formulas page.
  E3 Column properties: >
    From the Data pane: hide / show, format and sort by, saved per model
    (overlay files remain defaults).

  # --- Transformation engine (Power Query-like) ------------------------------
  T1 Queries: >
    A query has a name, a source and ordered applied steps. Sources: a table of
    the model (including another query's output — reference), or a calendar
    (fixed range, or the min / max of a date column). "Close & apply"
    materializes the result as a table named after the query in the
    connection's store; the model shows it with a Query badge. Queries re-apply
    in dependency order after their connection refreshes and on "Refresh all".
    Cycles are refused.
  T2 Steps (ribbon groups):
    Manage columns: choose columns (also sets order), remove columns, rename, duplicate column.
    Reduce rows: keep top N, remove top N, remove duplicates (all or chosen columns), remove blank rows, filter rows (conditions with and / or).
    Sort: sort rows by one or more columns.
    Transform: change type (text, integer, number, date, datetime, true/false; unconvertible values become blank and are counted as errors);
      replace values; fill down / fill up; split column by delimiter (2–10 parts); merge columns;
      text (trim, upper, lower, capitalize, add prefix / suffix); extract (first / last N characters, text before / after delimiter, length);
      number (round, absolute, add, multiply, divide); date (year, quarter, month, month name, day, weekday, start / end of month);
      group by (keys; count rows, count distinct, sum, average, min, max);
      unpivot columns / unpivot other columns; pivot column (values from a column, aggregate, at most 50 new columns).
    Add column: custom column (the row formula language of F1–F3), conditional column (rules → result, otherwise), index column (start, step), column from a date part.
    Combine: merge queries (left, inner, right, full, left anti, right anti; expand chosen columns with a prefix), append queries (columns aligned by name).
  T3 Transform editor: >
    Queries pane (left, collapsible; new query from a table, a reference or a
    calendar), ribbon tabs Home / Transform / Add column, preview grid of the
    first 200 rows with type icons and column quality (valid / empty / error %),
    column selection (Ctrl for several) with a context menu, Query settings
    (name, Applied steps: select to preview up to that step, edit, delete, move),
    a dialog per step, Close & apply. Available as a page and as a full-screen
    editor over the report.
  T4 Relationships: >
    Manage relationships per model: add a many-to-one relationship between any
    two tables (including query tables) after checking the "one" side's key is
    unique; remove user relationships. Foreign-key and overlay relationships are
    read-only.

invariants:
  I12: >
    Transform steps compile to SQL from validated step definitions, resolved
    against the previous step's inferred schema; every value, pattern and pivot
    value is a bound parameter in preview and in apply. New column names are
    validated (1–128 characters, no control characters) and reach SQL only
    through quoteIdent.
  I13: >
    Applying a query writes a new table and renames it into place in one
    transaction, and never replaces a table that is not that query's output.

constraints:
  - Preview returns at most 200 rows; p95 < 1 s on the bars in the spike.
  - A query has at most 100 steps; a materialized result at most 1,000,000 rows.
  - Queries and merges use tables of the same connection.
  - No new runtime dependencies; SQLite features only as probed.

architecture:
  - bi/transform/steps.js — step registry: validate(step, schema) → normalized step, compile(step, input) → { sql, columns } with bound params.   # T2, I12
  - bi/transform/index.js — query store (bi_queries), compile chain as CTEs with a hidden order column, preview, apply with atomic swap, dependency order, refresh hook in connectors.   # T1, I13
  - bi/model.js — marks query tables; merges user relationships (bi_relationships) and column properties (bi_column_props).   # T4, E3
  - bi/reports.js — category, description, status; bi_report_categories.   # R2
  - @tasnim/bi/modeling — FormulaEditorComponent, DataPaneComponent, TransformEditorComponent, RelationshipsComponent; depends on core only; report and admin import it (report through dynamic import for the Transform editor).   # E1–E3, T3, T4
  - report-list rewrite and BI_REPORT_PREFERENCES in core.   # R1, R3
  - data-sources collapsible sections.   # D1

api_contracts:
  - GET/POST /models/{id}/queries; PUT/DELETE /models/{id}/queries/{queryId}
  - POST /models/{id}/queries/preview { source, steps, upTo?, limit? } → { columns [{ name, dataType, empty, errors }], rows, rowCount }
  - POST /models/{id}/queries/{queryId}/apply; POST /models/{id}/queries/apply-all
  - GET/POST /models/{id}/relationships; DELETE /models/{id}/relationships/{relationshipId}
  - PUT /models/{id}/columns/properties { table, column, hidden?, format?, sortBy? }
  - Reports gain category, description, status; GET/PUT /report-categories
  - Table gains query { id } ; Relationship.source gains user

data_model_changes:
  - Meta tables bi_queries, bi_relationships, bi_column_props, bi_report_categories; bi_reports gains category, description, status (ALTER ADD COLUMN, idempotent).

rollout_plan:
  - Branch feature/twise-bi-modeling-v3 from feature/twise-bi-requirements-v2.
  - Order: D1 → R1–R3 → E1–E3 (modeling entry point) → T1/T2/T4 backend → T3 editor → E2E guide, QA.
  - Each group lands with tests and a browser check.

security_concerns:
  - "Transform steps: identifier and value handling per I12; injection tests for filter values, replace values, split delimiters, pivot values and new column names."
  - "Apply: I13 prevents a query named like a source table from destroying it."

compliance_flags:
  - none
