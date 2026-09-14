# Angular BI Prototype — 6 P-1 features, live SQLite

A working Angular 19 (standalone components, signals) demo of the 6 P-1 BI
capabilities from the feasibility tracker, wired to a real local SQLite
database — not a static mockup. Built per `docs/plans/angular-bi-prototype.md`.

## Run it

Two servers, both local:

```bash
# 1. Backend (SQLite + the metadata-validation-gate API)
cd ../query-builder-prototype
npm install
npm start          # http://localhost:4173

# 2. Angular app
cd ../angular-bi
npm install
npm start           # http://localhost:4200 (ng serve)
```

Open `http://localhost:4200`. The topbar shows live backend-connection status.

## What's LIVE vs. DEMO placeholder

Every screen in the app carries an explicit badge — nothing here silently
fakes data. Summary:

| Feature (tracker item) | Status | Notes |
|---|---|---|
| 01 Data connectivity | **LIVE** (SQLite) + placeholder cards | Real schema/preview for SQLite; SQL Server/SAP/Sheets/REST shown as labeled "Not connected in this demo" cards |
| 02 JSON flattening | **LIVE** | Real recursive flattener (`core/flatten.service.ts`) over real nested rows in `raw_events` |
| 03 Formula editor | **LIVE** for arithmetic, **PLACEHOLDER** for filter-context | Real jsep-based parser/evaluator over saved measures; `CALCULATE`-style filter-context modification is a labeled roadmap item, not approximated |
| 04 Custom visuals | **LIVE** | Real bar/line/pie switch, native SVG/CSS, no chart-library dependency; "Import Custom Visual" plugin loading is out of scope |
| 05 Filters | **LIVE** for field/operator/value + Group By; chip list shows which of the 12 tracker sub-types are live vs. planned |
| 06 Cross-filtering | **LIVE** | Real "selection bus" (`core/selection.service.ts`); clicking a bar re-runs a filtered SQL query against the second chart |
| AI mode | **DEMO PLACEHOLDER** (explicit, per instruction) | No live model call; static labeled example only |

## Security notes (carried over from the feasibility study, implemented for real here)

- Every query the Visual/Formula builders send is compiled server-side
  (`query-builder-prototype/server.js`) against the live schema
  (`PRAGMA table_info`) — table/column identifiers are never accepted
  as free text into SQL; filter values are always bound parameters.
- The Formula-mode parser (`core/formula.service.ts`) uses `jsep` to build
  an AST and evaluates it directly — never `eval()`/`Function()`. An
  unsupported expression type is rejected, not silently coerced.
- CORS on the backend is scoped to `http://localhost:4200` specifically,
  not a wildcard — this backend has no auth, so an open policy would let
  any page read local data through it.

## What's not here

Auth, multi-tenant row-level security, a production deployment, and a real
AI integration are all explicitly out of scope for this local demo — see
`docs/intent/angular-bi-prototype.md` for the full scope boundary.
