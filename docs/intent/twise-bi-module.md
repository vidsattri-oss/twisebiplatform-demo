problem: >
  The Angular BI prototype proves the 6 P-1 capabilities, but it cannot be
  plugged into TWise (Angular 22, Highcharts 13, AG Grid 36, tenant API), and
  several behaviours diverge from what Power BI users expect (clicked chart
  filters itself, See records drops filter context, no sort-by column, measures
  evaluated without group context). The business therefore cannot put
  Power BI-grade interactive reports inside TWise.
  Review: https://claude.ai/artifact/7XtfpD3ivKVnmjU7ruuKC3

proposed_outcome: >
  A pluggable Angular 22 library (@tasnim/bi) that TWise registers with
  provideBi() and one route, rendering reports with Highcharts and AG Grid in
  TWise's design tokens, and talking to one documented /api/bi contract.
  Demonstrated by rebuilding the Wells Readiness report in a host harness with
  Power BI parity, with all 6 features reachable.

success_criteria:
  - Pluggability — `ng build tasnim-bi` (ng-packagr) succeeds, and the library
    imports nothing from the harness app. Checked at build review, 2026-09-14.
  - Power BI parity (exact integers, COUNTROWS semantics), automated against the
    contract, in Parameter Sort Order:
      no filters            -> [196, 86, 64, 81, 23, 33, 7, 22, 316, 294]
      Plant = Marmul ODC    -> [134, 59, 43, 65, 0, 14, 6, 21, 197, 179]
      Planned Completion 2026-01-01..2026-06-30
                            -> [61, 0, 0, 0, 0, 0, 0, 19, 236, 216]
  - Cross-highlight — clicking a bar keeps all 10 bars on the source visual.
    See records for "Actual - Wells Completed" with Plant = Marmul ODC reports
    exactly 197 rows.
  - All 6 features are demoable in the harness, and every non-live element is
    marked as a placeholder.
  - Outcome review 2026-10-14: the TWise frontend team estimates integration at
    no more than 2 dev-days after reading the integration guide.

assumptions:
  - Host is Angular 22. Validated: TWise page carries ng-version="22.0.5".
  - Wells CSV is a faithful stand-in for the report's data. Validated: the CSV
    reproduces Power BI's counts exactly (docs/spikes/twise-bi-module.md).
  - TWise tenant API can add (or already has) a query endpoint that groups and
    filters. Validate with the .NET team, build order step 1. Risk if wrong: the
    adapter has to translate onto database-views/preview, which may not support
    grouping or selection.
  - TWise's Highcharts licence covers use inside this module. Validate with the
    TWise owner. Risk if wrong: visuals need a different renderer.

affected_users: >
  TWise report consumers (wells and operations planning), the TWise frontend
  team (integrates the library), and the TWise .NET team (implements /api/bi).

constraints:
  - Angular 22 standalone, OnPush + signals (zoneless-compatible); no global
    styles; theme only through CSS custom properties.
  - Highcharts 13 and AG Grid Community 36, matching the host versions.
  - Every SQL identifier comes from model metadata; every value is a bound
    parameter (the prototype's validation gate, preserved).
  - Runs entirely locally.

out_of_scope:
  - Changing the real TWise repo or tenant API.
  - Authentication and row-level security. The contract carries the hook;
    nothing enforces it yet.
  - CALCULATE, time intelligence, Module Federation, SAP/SQL Server connectors,
    and AI (TWise's Jenny assistant owns that).

open_questions:
  - The .NET SDK is not installed locally. Build the .NET module now, or ship a
    Node reference implementation of the contract and port later?
  - The Wells CSV looks like real well data. Keep it out of git and seed from its
    current folder?
  - Keep the old angular-bi app alongside until the outcome review, or replace it?
