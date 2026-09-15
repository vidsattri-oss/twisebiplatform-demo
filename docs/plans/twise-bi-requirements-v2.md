date: 2026-09-15
research_trigger: full-tier
evidence: docs/spikes/twise-bi-requirements-v2.md
spec: docs/specs/twise-bi-requirements-v2.md

work_order:
  - 1. QA findings from the 2026-09-15 review (validation crash, layout overflow, per-measure label formats, per-request COUNT(*), ingest name collision, WITHOUT ROWID rows) with regression tests in new files.
  - 2. Theme T1: logo palette tokens, chart palette token, grid theme, harness logo; browser check.
  - 3. Filters L1–L8 and cross-filtering C1–C2 (dataset filters, include/exclude, relative date presets and units, relative time + datetime type, boolean, blank shortcuts, slicer defaults, reset to default, table row selection, multi-select setting).
  - 4. Formulas F1–F6 (logical, text, date, X-aggregations, calculated columns, text/KPI measures) with editor function reference and preview.
  - 5. JSON J1–J2: appmaster.db stand-in with JSON columns; flatten-a-column with key selection.
  - 6. Connectors S1–S4: typed connections, CSV and dependency-free Excel upload, REST and Google shared-link pulls with allow list and encrypted tokens, SQL Server / cloud DB / SAP connector interface with mocked-driver contract tests.
  - 7. Custom visuals V1–V3: plug-in manifest + code store, sandboxed iframe runtime, Visuals page, two sample plug-ins.
  - 8. End-to-end verification guide (published) covering every sub-feature; independent QA; fixes.

tests_to_write:
  - Each work-order group adds backend unit/contract tests and library specs for every new behaviour; existing Wells parity and I1–I7 tests stay green.

risks:
  - Scope is large; each group lands separately with tests and a browser check so a partial stop still leaves working software.
  - Sandboxed iframe plug-ins: verify postMessage round trip first (spike kill criterion).
  - Outbound pulls: SSRF; allow list enforced server-side with tests.

progress:
  - 2026-09-15 groups 1–7 landed as separate commits on feature/twise-bi-requirements-v2 with tests (backend 104, library 52, harness 5).
  - Browser-checked: theme, Include / Exclude, Reset to default, table row selection, plug-in frames render, AppMasterDB report defaults. Formulas, JSON-column flattening, connectors and plug-in install checked through the API while the app window was hidden; UI pass listed in the verification guide.
  - Verification guide published: https://claude.ai/artifact/DhFvYnf7bNKY3VQTZ1GgzL
  - Needs an outside system: SQL Server / PostgreSQL (driver package + reachable server), SAP OData service, Google files shared by link.
  - Open: independent QA in a fresh session; plug-in import must be restricted to editors in the TWise .NET API (no auth in the prototype).

done_when:
  - Gap matrix rows all "live" or "needs <external system>".
  - Backend, library and harness suites pass; harness production build within budget.
  - E2E guide published and each step verified in the browser.
