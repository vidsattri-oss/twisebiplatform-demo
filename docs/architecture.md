# BI module architecture

This is the v3 local-development topology. It is deliberately split into a
host shell, a BI API, and a small preferences service so each boundary maps to
the production integration point.

```mermaid
flowchart LR
  browser[Browser]
  host[host-harness\nAngular :4200]
  lib[@tasnim/bi\nAngular library]
  api[query-builder-prototype\nExpress BI API :4173]
  prefs[preferences-server\nHTTP preferences :4175]
  meta[(data.db\nmetadata + demo model)]
  landed[(connections/*.db\nlanded source data)]
  external[(External systems\nREST · Sheets/Drive · SAP/OData\nSQL Server/AppMasterDB · PostgreSQL)]

  browser --> host
  host --> lib
  lib -->|/api/bi contract| api
  lib -->|favorites + recents| prefs
  api --> meta
  api --> landed
  api --> external
  api -->|validated queries + formulas| landed
```

## Service ownership

| Service or package | Port | Owns | Required by |
|---|---:|---|---|
| `twise-bi/projects/host-harness` | 4200 | TWise-like shell, routes, provider wiring, demo custom visual | Browser UI; consumes the library |
| `twise-bi/projects/tasnim-bi` | build-time package | Core contract/state, report UI, filter context, formulas UI, data-source admin, visual registry, sandbox host | Any Angular host integrating BI |
| `query-builder-prototype` | 4173 | `/api/bi`, metadata validation, model/query engine, DAX compiler, report persistence, ingestion, connector refresh, plugin catalog | Host harness and automated contract tests |
| `preferences-server` | 4175 | Per-user favorite and recent-report persistence | Host harness report home in local development; optional in production |
| `data.db` | file | Operations model, connection registry, report/measure metadata | Backend only; never accessed directly by the browser |
| `connections/*.db` | files | One landed SQLite store per uploaded/pulled/remote connection | Backend query/model layer |
| External connector drivers | optional | SQL Server and PostgreSQL snapshots | Only when a live database connection is configured; CSV/Excel/REST/Sheets/SAP do not require database drivers |

## Request flow

1. The browser loads the host harness at `:4200`.
2. `provideBi()` configures `HttpBiDataSource` with
   `http://localhost:4173/api/bi` in development. The library does not build
   SQL in the browser.
3. The BI API resolves tables and columns from live model metadata, validates
   identifiers and types, binds values, and executes against the selected
   connection store.
4. Pull connectors pass through the outbound URL guard, land normalized data
   into the connection's SQLite file, and expose it through the same model
   contract. Refresh scheduling runs inside the BI API process.
5. Report filters and selections become a shared visual context. The source
   visual receives highlight data when configured; other visuals receive a
   filter or highlight according to their interaction mode. See records is
   built from the same context.
6. The report home calls `preferences-server` for favorites and recent reports.
   If a production host already has a user-preferences API, it supplies that
   endpoint through `provideBi({ preferences: ... })`.

## API ownership map

| Capability | BI API routes | Main implementation |
|---|---|---|
| Models, schema, query, rows, values | `/api/bi/models`, `/query`, `/rows`, `/values` | `bi/model.js`, `bi/query.js`, `bi/routes.js` |
| Formulas and calculated columns | `/measures/*`, `/models/:id/measures`, `/models/:id/columns` | `bi/dax.js`, `bi/routes.js` |
| Connections and refresh | `/connections/*` | `bi/connectors/index.js`, `database.js`, `outbound.js` |
| CSV, Excel, JSON, JSON-column flattening | `/ingest/*` | `bi/ingest.js`, `csv.js`, `xlsx.js` |
| Reports, categories, dataset filters | `/reports/*`, `/report-categories`, `/models/:id/dataset-filters` | `bi/reports.js`, `bi/routes.js` |
| Custom visuals | `/visuals/*` | `bi/plugins.js`, `core/plugin-visuals.ts`, sandboxed visual host |
| User preferences | `/api/users/me/report-preferences` | `preferences-server/server.js` |

## Production boundary

The local Express server is a reference implementation of
`docs/api/bi-contract.openapi.yaml`. The production replacement is a TWise
tenant API (for example, .NET) that implements that contract and owns tenant
authentication, row-level security, secret storage, source credentials,
refresh workers, and durable report storage. The Angular host should keep
calling the contract and should not connect to databases directly.

## Modularity and pluggability

The current boundaries are suitable for embedding into a larger TWise
solution:

| Extension point | Host integration | What stays reusable |
|---|---|---|
| Backend | Implement `docs/api/bi-contract.openapi.yaml` in the tenant API, or point `provideBi({ apiBaseUrl })` at an existing gateway. | Report, filter, formula, and visual UI |
| Data access | Provide a `BiDataSource` implementation for authenticated TWise services instead of `HttpBiDataSource`. | All report state and visual context |
| User preferences | Provide `preferences: { url, userId }` or a `ReportPreferences` class. | Reports home, favorites, and recents |
| Host filters | Provide the optional `filterBridge` adapter. | Dataset/report/page/visual filter model |
| Visuals | Register a `BiVisualType` with `provideBiVisual()` or install/import a sandboxed plug-in. | Visual registry, selection, See records, and interaction context |
| Canvas authoring | The reusable report editor supplies a 12-column magnetic grid with bounded move/resize handles and collision-aware snapping. | Report definitions keep the portable `VisualLayout` contract |
| Data sources | Add a connector type behind the backend registry and land it through the same model/query contract. | Angular data-source UI and query builder |

The secondary entry points keep the library modular: `core` contains the
contracts and state, `report` contains report composition, `admin` contains
management screens, `modeling` contains formula/data modeling, and `visuals`
contains chart/grid runtimes. The host harness is a consumer and is never
imported by the library.

Production hardening still belongs in the larger solution: tenant
authentication, RBAC/row-level security, KMS-backed secrets, durable report
storage, background refresh workers, observability, and rate limits. The
module's contract and dependency-injection seams keep those concerns outside
the feature components.

### Code-authored visuals

Code-authored visuals are a useful complement to drag-and-drop authoring, but
arbitrary Python should not execute in the browser or inside the API process.
The current safe extension is JavaScript in a sandboxed iframe, with only the
visual's query result and selection/See-records bridge exposed. For a future
Python option, the recommended larger-solution design is an isolated worker
service that accepts a signed visual package, applies CPU/memory/time/network
quotas, and returns a declarative visual result (or a vetted SVG/HTML payload).
That keeps Python useful for advanced analytics while preserving tenant
isolation and the existing `BiVisualType`/`VisualLayout` contract. A Python
runner should be added only with explicit package allow-lists, authentication,
auditing, and a separate worker boundary.

## Safety and dependency rules

- Client identifiers are accepted only after model metadata validation; values
  are bound parameters.
- Pull URLs pass the allow-list, private-address, redirect, timeout, and size
  checks in `bi/connectors/outbound.js`.
- Secrets are encrypted before they are persisted and are never returned from
  connection APIs.
- Plug-in code is stored as JSON text and executed only inside a sandboxed
  iframe without `allow-same-origin`.
- The primary library entry point stays light. Chart/grid and admin/report code
  remain in secondary entry points so the host initial bundle does not pull in
  every visual dependency.
