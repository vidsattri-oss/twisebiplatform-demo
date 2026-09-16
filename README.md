# BI feasibility study

This repository contains the current v3 BI module prototype and its local
reference backend. The supported development path is the Angular host harness
in `twise-bi` backed by the contract-compatible Express service in
`query-builder-prototype`.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the service topology,
ownership boundaries, API routes, and the production integration seam.

```text
Browser :4200 (host-harness)
        │
        ├── /api/bi ───────────────► query-builder-prototype :4173
        │                             ├─ data.db (metadata + demo model)
        │                             ├─ connections/*.db (landed source data)
        │                             └─ REST/Sheets/SAP/database connectors
        │
        └── preferences API ───────► preferences-server :4175
                                      └─ data/preferences.json
```

The Angular library is `twise-bi/projects/tasnim-bi`. The host imports the
library through `provideBi()` and lazy-loads the report, admin, modeling, and
visuals entry points. The older `angular-bi` prototype has been removed; its
historical design notes remain under `docs/`.

## Run locally

Prerequisites: Node.js `>=24.15` and npm. Angular 22 will reject older Node
versions.

Open three terminals from the repository root:

```powershell
# Terminal 1: per-user favorites and recent-report preferences
npm --prefix preferences-server install
npm --prefix preferences-server start
# http://localhost:4175

# Terminal 2: BI contract API and local data/connectors
npm --prefix query-builder-prototype install
npm --prefix query-builder-prototype start
# http://localhost:4173

# Terminal 3: Angular host harness and @tasnim/bi library
npm --prefix twise-bi install
npm --prefix twise-bi start
# http://localhost:4200
```

Open `http://localhost:4200`. The host harness points to
`http://localhost:4173/api/bi` and the preferences service at
`http://localhost:4175` while running in development mode.

### One-command startup

PowerShell can start all three services, wait for their health endpoints, and
open the main BI page automatically:

```powershell
.\scripts\start-local.ps1 -Install
```

Use `.\scripts\start-local.ps1` on later runs. The script reuses healthy
services already listening on ports 4175, 4173, or 4200, starts missing
services in hidden background processes, and writes logs and PIDs under the
ignored `.local-run\` directory. Use `-NoBrowser` to skip opening the page.

If PowerShell blocks local scripts in the current session, run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

The backend creates its local SQLite stores on first use. Optional setup:

```powershell
# Copy .env.example to .env before starting if you need a stable encryption key
# or a custom REST allow-list.
npm --prefix query-builder-prototype run seed:wells
npm --prefix query-builder-prototype run seed:appmaster
```

SQL Server/AppMasterDB and PostgreSQL connectors are implemented behind
optional drivers. The local demo does not install those drivers or require a
live external database; the connection UI reports `Needs ...` until the
driver, credentials, and table list are available.

## Feature status and acceptance checks

| Requested capability | Current implementation | How to verify |
|---|---|---|
| Multiple data sources | SQLite, CSV, Excel, REST JSON, Google Sheets/Drive, SAP/ERP OData, SQL Server/AppMasterDB, and PostgreSQL connection types. Refresh is guarded, secrets are encrypted, and landed data is queryable through the same model contract. | Open Reports → Data sources. Add a connection, use Test/Refresh, then inspect the model. Automated coverage: `bi/test/connectors.test.js`, `connectors-api.test.js`, `csv.test.js`, `xlsx.test.js`. |
| JSON parsing and flattening | Recursive JSON ingestion creates typed scalar columns and linked child tables for arrays. JSON-column flattening handles task payloads such as `task_daily.daily_data`, `task_data`, and FLAF/PO/PEG/SCR/MOC-style nested objects. | Open Admin → JSON import, preview, import, and inspect the generated tables. Automated coverage: `bi/test/ingest.test.js`, `json-column.test.js`, `json-column-api.test.js`. |
| DAX-like formulas | Server-side AST parsing and SQL compilation support `IF`/`SWITCH` logic, arithmetic, text, date, aggregation/iterator functions, calculated columns, measures, and text/numeric KPI results. No `eval()` or `Function()` is used. | Open Admin → Formulas, validate and preview a measure such as `DIVIDE([Actual Quantity], [Planned Quantity])`, then use it in a visual. Automated coverage: `bi/test/dax.test.js`, `formulas.test.js`, `formulas-api.test.js`. |
| Magnetic canvas layout | Edit mode presents visuals as bounded blocks on a 12-column grid. Use the visible Move control to shuffle a block and the bottom-right handle to resize it; movement snaps to the grid and finds the nearest free slot on drop. Date slicers get enough height for their range controls. | Open a report, choose Edit, use Move or the resize handle, then Save. Numeric layout controls remain available for precise placement. Automated coverage: `core/src/layout.spec.ts`. |
| Custom visuals | Catalog installation and manifest/code import are supported. Plug-in code is returned as text and runs only in an iframe with `sandbox="allow-scripts"`; it can request selection or See records through the host bridge. A ready-to-import example is in `docs/examples/sample-visual/`. | Open Admin → Visuals, install a catalog visual or import that folder's `manifest.json` and `visual.js`, then add it from the Visualizations pane. Automated coverage: `bi/test/plugins-api.test.js` and the visual host specs. |
| Filters | Visual, page, report, and dataset scopes; include/exclude; Top/Bottom N; relative date/time; blank/not blank; boolean; search; saved defaults; filter-aware/cascading slicer values; and one-click Reset to default. | Edit a report, add filters at each scope, search a slicer, select a relative-date preset, set a default, then use Reset to default. Automated coverage: `bi/test/filters-v2.test.js`, `dataset-filters-api.test.js`, and `core/src/filter-actions.spec.ts`. |
| Cross filtering | Filter, highlight, none, single selection, multi-select, Ctrl/Cmd multi-select, clear selection, and See records use one shared visual context. | Select a chart bar, Ctrl/Cmd-click another bar, change interaction mode in the Visualizations pane, and use Clear selection/Reset to default. Automated coverage: `bi/test/qa-regressions.test.js` and `core/src/filter-context.spec.ts`. |

The backend tests also enforce identifier validation, bound values, SSRF
protection, relationship-aware filters, and the shared See records context.

## Test and build commands

Run the fast checks from the repository root:

```powershell
node scripts/check-evidence.mjs
npm --prefix preferences-server test
npm --prefix query-builder-prototype test
npm --prefix twise-bi run test
npm --prefix twise-bi run build
```

`npm --prefix twise-bi run test` runs the library tests, builds all library
entry points, and runs the host-harness test. The commands may need approval
in restricted CI environments because Angular/esbuild and Node's test runner
spawn child processes.

## Production seam

The Angular module depends on the relative `/api/bi` contract documented in
`docs/api/bi-contract.openapi.yaml`, not on SQLite internals. A TWise tenant
API can replace the local Express service while keeping the same model, query,
formula, report, connection, ingestion, and visual plug-in routes. In
production, the host should provide authentication, tenant isolation, secret
storage, and the real preferences API.

## Modularity and larger-solution integration

The feature set is designed as a pluggable module rather than a single-page
application:

- Angular hosts integrate with `provideBi({ apiBaseUrl, dataSource,
  preferences, filterBridge, palette })`; a host can replace the default HTTP
  data source or preferences adapter without changing report components.
- `@tasnim/bi/core`, `report`, `admin`, `modeling`, and `visuals` are separate
  entry points. Chart/grid/admin code stays out of the host's initial bundle.
- New custom visuals use `provideBiVisual()` or the catalog/import API and run
  in a sandboxed iframe.
- The report canvas uses a bounded 12-column layout with magnetic snap and
  collision avoidance. Hosts can keep the same report definition while
  replacing the editor surface later.
- New data sources land behind the connection registry and the stable
  `/api/bi` contract. The Angular module does not connect directly to a
  database, so the local Express service can be replaced by a tenant API.

Before production integration, add tenant authentication/RBAC, row-level
security, durable secret/KMS storage, background refresh workers, monitoring,
and an enterprise persistence layer. Those are deployment responsibilities,
not reasons to fork the feature modules.
