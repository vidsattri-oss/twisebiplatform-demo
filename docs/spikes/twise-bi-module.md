date: 2026-09-14
mode: evidence
question: >
  Can the prototype's 6 features be delivered as an Angular library that matches
  TWise's stack and reproduces Power BI's Wells Readiness numbers, using this
  machine's toolchain?

prior_art:
  - ../docs/spikes/pbir-visual-authoring.md — Power BI report files must be
    edited as PBIP, never .pbix (SecurityBindings tamper seal). No negative
    results about Angular or BI modules.
  - angular-bi prototype at 92c3427 plus the review at
    https://claude.ai/artifact/7XtfpD3ivKVnmjU7ruuKC3 (5 blocking and 7 high
    findings). Keep: the metadata validation gate, bound parameters, no eval.
  - No CLAUDE.md or Common Mistakes exist in this repo yet.

outside_evidence:
  - TWise bundle (live, signed-in session): ng-version="22.0.5", "Created with
    Highcharts 13.0.0", AG Grid "36.1.0", DAX tokenizer in the chart-detail
    chunk, 13 chart types with a switch-compatibility map.
  - Power BI model (PBIP TMDL): `measure 'Well Count' = COUNTROWS(...)`;
    `Parameter sortByColumn 'Parameter Sort Order'`, where the sort order is
    List.PositionOf over a fixed 10-item list in Power Query. Visuals:
    clusteredColumnChart (Parameter x Well Count), tableEx (8 columns), slicers
    Dropdown(Plant Description), Dropdown(Well Type),
    Between(Planned Completion Date (Date)).
  - npm registry: highcharts 13.0.2; highcharts-angular 5.4.1 (peers
    @angular/core >=19, highcharts >=12.2); ag-grid-angular 36.1.0 (peers
    @angular/core >=20); ng-packagr 22.x (typescript >=6.0 <6.1).

probes:
  - cmd: python — count Parameter in "Wells Readiness - Plan v_s Actual_drilldown.csv"
    output: |
      rows 1122 cols 25
      ALL 1122 [196, 86, 64, 81, 23, 33, 7, 22, 316, 294]   # == Power BI screenshots, exact
      Plant=Marmul ODC 718 [134, 59, 43, 65, 0, 14, 6, 21, 197, 179]
      Plant=Nimr ODC 404 [62, 27, 21, 16, 23, 19, 1, 1, 119, 115]
      WellType=ESP 93 [11, 5, 5, 7, 0, 1, 2, 0, 31, 31]
      PlannedCompletion 2026-01-01..2026-06-30 532 [61, 0, 0, 0, 0, 0, 0, 19, 236, 216]
      Actual Completed & Marmul 197
      planned completion non-empty 756 min 2025-10-13 max 2026-12-17
      distinct well ids 418   # a well appears under several Parameters; COUNTROWS, not DISTINCTCOUNT
  - cmd: dotnet --list-sdks
    output: "(command not found)"
  - cmd: node -v
    output: v24.11.1
  - cmd: npm view @angular/cli@{22.0.5,22.1.8,21} engines.node
    output: |
      22.0.5   ^22.22.3 || ^24.15.0 || >=26.0.0
      22.1.8   ^22.22.3 || ^24.15.0 || >=26.0.0
      21.2.24  ^20.19.0 || ^22.12.0 || >=24.0.0
  - cmd: npx -p @angular/cli@22.0.5 ng version   (scratchpad)
    output: |
      Node.js version v24.11.1 detected.
      The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0.

bars:
  - Parity: exact integer equality on all three intent vectors (COUNTROWS, no tolerance).
  - Pluggability: `ng build tasnim-bi` succeeds; no import in projects/tasnim-bi
    resolves into projects/host-harness; library styles contain no element or
    :root selectors.
  - Latency: /api/bi/query p95 < 300 ms over 50 runs on the Wells model locally.
  - Kill: if highcharts-angular or ag-grid-angular cannot render in a
    zoneless/OnPush library component on the chosen Angular major, stop and
    return to intent.
  - Unmeasurable locally: .NET compile and tests (no SDK); Angular 22 build
    (Node 24.11 below the CLI minimum) until Node is upgraded; TWise integration
    effort (outcome review only).

decision: proceed-full   # escalation list: new public API contract between module and host
blockers_for_human:
  - The Angular 22 CLI will not run on Node 24.11.1. Either upgrade Node to 24.15+
    (then build on Angular 22, matching the host exactly), or build on Angular 21.2
    (supports Node 24.11; library peer range ^21 || ^22; the harness verifies on
    21 only).
  - No .NET SDK. Either use the Node reference implementation of the contract now
    with a .NET port later, or install a .NET SDK to build Tasnim.Bi here.
  - The Wells CSV looks like real PDO well data. Keep it out of git by default.

learnings_for_spec:
  - Re-scaffold on the target major rather than `ng update` 19 -> 22 (three majors, prototype code is being restructured anyway).
  - ag-grid-angular 36 needs Angular >= 20, so Angular 19 is ruled out.
  - Acceptance tests must use COUNTROWS semantics (418 distinct wells vs 1,122 rows) and Parameter Sort Order.
  - Highlight needs value and highlighted-value in one query; see spec highlight_semantics.
