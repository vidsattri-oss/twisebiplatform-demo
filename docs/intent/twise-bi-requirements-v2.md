problem: >
  The TWise BI module (docs/intent/twise-bi-module.md) delivers the six P-1
  capabilities at headline level, but the product owner's detailed requirement
  list (2026-09-15) defines sub-features that are missing or partial: most data
  source types, flattening JSON stored in database columns, logical/text/date
  formula functions, runtime-imported visuals, 6 of 16 filter capabilities and
  2 of 6 cross-filtering capabilities. Stakeholders cannot sign off a feature
  whose sub-features cannot be shown working. The module must also carry the
  Al Tasnim logo colour scheme throughout.

proposed_outcome: >
  Every sub-feature in the requirement list is either demonstrably working end
  to end in the TWise harness against real data, or — only where an external
  system this machine cannot reach is required — implemented to the contract
  with a clearly labelled "needs <system>" state and a documented path. A
  published end-to-end verification guide lets a stakeholder check each
  sub-feature themselves in under an hour.

success_criteria:
  - Gap matrix in docs/spikes/twise-bi-requirements-v2.md shows every row as
    "live" or "needs external system (named)"; zero rows "missing".
  - Each live row has a scripted check in the E2E guide and an automated test
    (backend contract/unit or library spec).
  - Existing acceptance vectors (Wells parity, 197 rows, source visual keeps all
    bars) still pass.
  - Logo palette (#2841A3, #E38200, #59585D) is the default across charts, grid,
    controls and harness shell.
  - Review date: 2026-10-14 outcome review, together with twise-bi-module.

assumptions:
  - Node's built-in fetch is enough for REST API and published Google Sheet
    connectors. Validated by probe.
  - Real SQL Server / AppMasterDB, cloud databases and SAP are not reachable from
    this machine (no Docker, no credentials). Risk if wrong: those rows could be
    verified live instead of by contract tests; low cost to revisit.
  - Custom visuals imported at runtime can run in a sandboxed iframe with
    postMessage, the same isolation model Power BI uses. Validate in build step 1
    of the plan before building marketplace UI.

affected_users: >
  TWise report authors and viewers; TWise frontend and .NET teams; data owners
  whose sources get connected.

constraints:
  - All invariants I1–I7 of docs/specs/twise-bi-module.md still hold.
  - Third-party visual code never runs in the host page's origin.
  - Outbound HTTP from the backend only to hosts on an explicit allow list.
  - Credentials are encrypted at rest (secrets.js) and never returned to clients.

out_of_scope:
  - CALCULATE filter-context modification and time-intelligence functions.
  - Google OAuth consent flows (needs a Google Cloud project owned by Al Tasnim).
  - Production deployment of connectors inside the .NET tenant API.

open_questions:
  - Approve adding exceljs as a backend dependency for Excel import?
  - SQL Server / AppMasterDB — test against a reachable instance (connection
    details), install Docker for a local instance, or verify by contract tests only?
  - Google Drive / Sheets — published-link pulls now, OAuth later?
