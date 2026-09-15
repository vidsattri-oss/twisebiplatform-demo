# Tasnim BI — Feasibility Study

## Build & Test

Run fastest first; stop at the first failure.

```bash
node scripts/check-evidence.mjs                                   # lifecycle guardrails (evidence links, no data files in git)
npm --prefix query-builder-prototype test                         # /api/bi reference backend: unit + contract tests (node:test)
npm --prefix query-builder-prototype run seed:wells               # builds connections/wells.db from WELLS_CSV (not in git)
npm --prefix twise-bi run test                                    # library unit tests
npm --prefix twise-bi run build:lib                               # ng-packagr build of @tasnim/bi; fails if the library imports the harness
npm --prefix twise-bi run build                                   # host-harness build
```

- Backend: `npm --prefix query-builder-prototype start`, then open http://localhost:4173.
- Harness: `npm --prefix twise-bi start`, then open http://localhost:4200.
- Angular 22 needs Node >= 24.15.

## Architecture

- `twise-bi/projects/tasnim-bi` — the pluggable library. Entry points: `core` (types, `BI_DATA_SOURCE`, `ReportStore`, filter-context builder, visual registry), `visuals` (Highcharts / AG Grid), `report` (`<bi-report>`, filter pane, Visualizations pane, See records), `admin` (data sources, JSON import, measure editor), `http` (`HttpBiDataSource`).
- `twise-bi/projects/host-harness` — a TWise-like shell that consumes the library exactly as TWise would. Nothing in the library may import from it.
- `query-builder-prototype/bi/` — Node reference implementation of `docs/api/bi-contract.openapi.yaml`, mounted at `/api/bi`. TWise's .NET tenant API will implement the same contract.
- `angular-bi/` — superseded prototype, kept until the 2026-10-14 outcome review.
- Lifecycle records: `docs/{intent,spikes,specs,plans}/twise-bi-module.md`.

## Common Mistakes

- **Letting a client string reach SQL text.** Every identifier must be resolved from model metadata (`bi/model.js`) and quoted with `quoteIdent`. Values are always bound parameters. Contract tests include injection attempts.
- **Building a visual's query and its See records context separately.** Both must come from `buildFilterContext` (spec invariant I3). The old prototype's drill-down dropped the selection this way.
- **Filtering a visual by its own selection.** The source visual gets highlight, not filter (I4). The old prototype collapsed the clicked chart to one bar.
- **Counting distinct wells instead of rows.** Wells parity uses COUNTROWS: 1,122 rows but only 418 distinct well IDs.
- **Ordering categories by value.** Honour `sortBy` (Parameter → Parameter Sort Order).
- **Global CSS in the library.** No element, `:root` or `body` selectors. Theme only through `--bi-*` custom properties.
- **Committing the Wells CSV or any `.db` file.** It's real well data; seed from `WELLS_CSV`.
- **Running Angular 22 on Node < 24.15.** The CLI exits with a version error.

## Conventions

- Angular: standalone components, `ChangeDetectionStrategy.OnPush`, signal `input()`/`output()`, `inject()`. No `providedIn: 'root'` for report state; `ReportStore` is provided per `<bi-report>`.
- Every data request is cancellable. The latest request for a visual wins (I7).
- Backend: CommonJS, no new runtime dependencies. Tests use `node:test` and live next to code in `bi/test/`.
- One commit per plan work item; message states which spec requirement or invariant it serves.
