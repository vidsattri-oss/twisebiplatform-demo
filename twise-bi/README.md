# `twise-bi`

This workspace contains the reusable `@tasnim/bi` Angular library and its
`host-harness` demo application. The full repository runbook is at the root
[README.md](../README.md); the service topology is in
[docs/architecture.md](../docs/architecture.md).

## Local development

From the repository root, start the BI API, preferences service, and host
harness in separate terminals:

```powershell
npm --prefix preferences-server start       # :4175
npm --prefix query-builder-prototype start  # :4173
npm --prefix twise-bi start                 # :4200
```

Then open `http://localhost:4200`. `host-harness` configures the library with
`http://localhost:4173/api/bi` and the local preferences endpoint.

From the repository root, the same three processes can be started with one
PowerShell command:

```powershell
.\scripts\start-local.ps1 -Install
```

The script is idempotent for healthy services, opens the host URL, and stores
background-process logs under `.local-run\`.

## Build and test

```powershell
npm run test       # library tests, package build, host-harness test
npm run build      # production library + host-harness build
npm run build:lib  # package entry points only
```

Angular 22 requires Node.js `>=24.15`.

## Library entry points

- `@tasnim/bi`: `provideBi()`, routes, core contract, and provider wiring.
- `@tasnim/bi/core`: contracts, filters, report state, selection context, and
  plug-in registry; no chart/grid dependencies.
- `@tasnim/bi/report`: report list, report canvas, filter pane, visualizations,
  See records, and interaction controls.
- `@tasnim/bi/admin`: data sources, JSON import, formula editor, and custom
  visual catalog/import.
- `@tasnim/bi/modeling`: report Data pane, formula editor, and column
  properties.
- `@tasnim/bi/visuals`: built-in chart/grid/slicer renderers and the sandboxed
  plug-in visual host.

The dependency direction is one-way: `admin` -> `report` -> `visuals`/`core`,
with `modeling` depending on `core`. The host harness must not be imported by
the library.

## Integration seam

The library is host-pluggable through `provideBi()` and the `BiDataSource`
interface. A larger TWise solution can provide its own authenticated data
source, preferences adapter, filter bridge, palette, and custom visuals while
keeping the report/filter/formula components unchanged. The local backend is
only a reference implementation of `docs/api/bi-contract.openapi.yaml`.
