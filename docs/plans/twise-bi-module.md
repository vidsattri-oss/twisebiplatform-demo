date: 2026-09-14
research_trigger: full-tier
evidence: docs/spikes/twise-bi-module.md
spec: docs/specs/twise-bi-module.md

files_to_change:
  - CLAUDE.md, REVIEW.md, scripts/check-evidence.mjs            # guardrails
  - docs/api/bi-contract.openapi.yaml                            # contract
  - query-builder-prototype/bi/{csv,model,dax,query,ingest,reports,routes}.js
  - query-builder-prototype/bi/test/*.test.js
  - query-builder-prototype/seed-wells.js, models/wells.db.json, models/data.db.json
  - query-builder-prototype/server.js                            # mount /api/bi, export app, keep old routes
  - query-builder-prototype/package.json                         # test + seed scripts, no new runtime deps
  - twise-bi/ (new Angular 22 workspace: projects/tasnim-bi, projects/host-harness)
  - .gitignore

work_order:
  - 1. Guardrails: CLAUDE.md, REVIEW.md, evidence and data check. [Stage 4]
  - 2. OpenAPI contract for /api/bi. [R2, R3–R10]
  - 3. Model layer: CSV parser, Wells seed (Power BI types; Parameter Sort Order computed like Power Query), model built from schema + real foreign keys + JSON overlay + user measures. [R3, I1]
  - 4. DAX subset: tokenizer, parser with positioned errors, SQL compiler with highlight variant and cycle detection. [R5, I1]
  - 5. Query compiler: typed filters (basic/advanced/range/relativeDate/topN), many-to-one join paths, ignored-filter reporting, highlight CASE aggregates, sortBy, date levels, rows with total, slicer values with range. [R7–R9, I1–I4, I6]
  - 6. JSON ingest: records to columns, lists to child tables with foreign keys, schema evolution, replace mode, dry-run preview. [R4]
  - 7. Routes + reports store + seeded Wells report; server exports app for contract tests; latency probe. [R3–R10]
  - 8. Angular 22 workspace (needs Node >= 24.15): library + harness scaffolds, Highcharts, AG Grid. [R1]
  - 9. Library core: contract types, BI_DATA_SOURCE + HttpBiDataSource, provideBi, visual registry + provideBiVisual, pure filter-context builder, ReportStore with switchMap cancellation. [R1, R2, R6, I3, I4, I7]
  - 10. Visuals: Highcharts column/bar/line/pie/donut with highlight and keyboard; AG Grid table; card; slicer (dropdown, list, between, relative date). [R6–R8]
  - 11. Report UI: <bi-report> pages, filter pane by scope, visual header ("filters on this visual", See records, edit, remove), See records sheet, drill breadcrumb, Visualizations pane (add/edit). [R7–R10]
  - 12. Admin: data sources + model browser (tables, types, relationships), JSON import (preview → ingest), measure editor (validate → save). [R3–R5]
  - 13. Harness: TWise-like shell with a global filter bar bridged to report scope, plus a custom visual registered from the host. [R1, R6]
  - 14. Checks, visual verification of every key state, then independent QA in a fresh session → fix → re-QA.

tests_to_write:
  backend:
    - csv: quoted commas, embedded quotes and newlines, CRLF, BOM.
    - model: Wells column types match Power BI; data.db relationships come from foreign keys; overlay sortBy/hidden/measures apply; unknown overlay column rejected.
    - dax: COUNTROWS/SUM/DIVIDE compile; [Measure] references inline; cycles rejected; unknown column/table error with position; non-numeric junk rejected; no identifier from the expression reaches SQL unless it's resolved.
    - query: the three Wells parity vectors (skipped with a clear message if WELLS_CSV absent — synthetic fixtures cover the logic); Actual & Marmul rows total 197; source-visual highlight keeps all 10 groups; relationship propagation crews → tasks; filter on an unrelated table reported as ignored; topN; relativeDate with fixed asOf; date levels; sortBy order; typed-value rejection; identifier injection → 400.
    - ingest: nested record flatten; list of objects → child table with FK; list of scalars → value table; new field adds a column; replace mode does not duplicate.
    - contract: each endpoint's status and shape over HTTP; p95 latency bar.
  library:
    - filter-context builder: scopes union; selection applies as filter to other visuals, highlight to source; interaction none; See records context equals the visual context plus the data point (I3, I4).
    - ReportStore: superseded request cancelled (I7).
    - registry: provideBiVisual adds a type without touching the library.

risks:
  - Node < 24.15 blocks steps 8–13 until the owner upgrades. Mitigation: backend first.
  - ag-grid-angular / highcharts-angular with zoneless OnPush. The kill criterion from the spike applies; verify in step 10 before building more UI.
  - Ambiguous relationship paths (tasks → crews directly and via equipment). BFS takes the shortest path; documented, and Power BI would require one inactive.
  - Relative dates depend on "today". The server accepts asOf and tests fix it.
  - Highcharts licence confirmation is pending with the TWise owner (compliance flag).

done_when:
  - node scripts/check-evidence.mjs passes.
  - npm --prefix query-builder-prototype test passes, including the Wells parity vectors with WELLS_CSV present.
  - /api/bi/query p95 < 300 ms over 50 runs on the Wells model.
  - npm --prefix twise-bi run test, build:lib and build pass; no library import resolves into the harness; no global selectors in library styles.
  - In the harness, the Wells report shows [196, 86, 64, 81, 23, 33, 7, 22, 316, 294] in Parameter Sort Order; Plant = Marmul ODC shows the Marmul vector; clicking "Actual - Wells Completed" keeps 10 bars; See records on that bar with Marmul shows 197 rows.
  - Independent QA reports no new critical/high findings.
