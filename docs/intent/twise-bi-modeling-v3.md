date: 2026-09-15
problem: >
  Report authors in TWise can connect data and build reports, but cannot shape
  data before using it: a table that needs columns removed, types fixed, values
  split, rows grouped, pivoted/unpivoted or joined to another table has to be
  prepared outside the product. Measures and calculated columns live on a
  separate page, so authors leave the report they are editing to create one.
  The Reports home is a flat list that doesn't match the TWise "Standard Charts"
  pattern authors already know (categories, favorites, recent, search, sort),
  and the Data sources page spends most of the screen on lists that can't be
  collapsed.

proposed_outcome: >
  A Power Query-style Transform editor — queries made of applied steps, with a
  live preview — whose results become tables the model, formulas and reports use
  like any other table. Authors open it, and create measures and calculated
  columns, from the left side of the report editor without leaving the report.
  The Reports home follows the TWise Standard Charts layout, and Data sources
  sections collapse.

success_criteria:
  - An author can build "Crew productivity" from AppMasterDB (flattened
    task_daily metrics → group by crew → custom column → merge plant names) in
    the Transform editor, apply it, and chart it in a report without leaving
    the report editor. Verified in the browser and scripted in the E2E guide.
  - Every step type in the spec has a backend test proving its SQL result on a
    fixture and that values are bound (I12).
  - Preview of 200 rows returns in under 1 s (p95) on the Wells and AppMasterDB
    data; applying a query over the 1,122 Wells rows takes under 2 s.
  - Reports home offers All / Favorites / Recent with counts, search, category
    filter, sort, grid / list / compact views and collapsible category sections.
  - Data sources: Connections and every model section collapse, and the choice
    is remembered.
  - Existing suites (backend 104, library 52, harness 5) stay green.
  - Review date: 2026-10-14 outcome review, with twise-bi-module and v2.

assumptions:
  - SQLite (3.53 in node:sqlite) supports every SQL construct the steps need —
    window functions, RIGHT / FULL joins, recursive CTEs, CREATE TABLE AS with
    bound parameters, atomic rename. Validated by probe (spike).
  - Materializing query results (Import mode) is acceptable to authors, as in
    Power BI, provided queries re-apply after their source refreshes.
    Risk if wrong: authors expect live views; a view mode would need literal
    inlining and a new safety review.
  - Favorites and recent reports are per person; the prototype has no sign-in,
    so the library stores them per browser behind a replaceable service TWise
    implements against its user API.

affected_users: >
  TWise report authors (transform, model, report editing), report viewers
  (Reports home), TWise frontend and .NET teams (contract additions).

constraints:
  - Invariants I1–I11 still hold; no new runtime dependencies.
  - Transform steps never put a user-supplied value into SQL text.
  - Applying a query never overwrites a table that isn't that query's output.

out_of_scope:
  - Power Query M language and a free-text Advanced Editor.
  - Query parameters, column from examples (AI), combine files, fuzzy merge.
  - Incremental refresh, dataflows, row-level security.
  - Many-to-many relationships, DAX calculated tables, visual calculations, quick measures.

open_questions:
  - Approve the scope and build order in the plan?
  - Query output: materialized table (recommended) or live view?
  - Favorites / recent: per browser behind a replaceable service (recommended) or server-side per user?
  - From the report editor, open Transform as a full-screen editor over the report (recommended) or a new tab?
