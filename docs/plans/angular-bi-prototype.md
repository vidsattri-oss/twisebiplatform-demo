date: 2026-09-14
tier: Standard
  # Not Full: no auth, payments, PII, production schema, public API contract,
  # or production infrastructure — a local demo prototype. Escalation-list
  # items (schema/migrations) apply to a throwaway local SQLite file, not a
  # production system.
research_trigger: none
  # No threshold/cutoff is being set; nothing here can only be judged on
  # real production data; no high-risk unvalidated assumption remains — the
  # riskiest assumption (can a metadata-validated query builder be safely
  # wired to a live local source?) was already answered this session by the
  # working Express + SQLite prototype (query-builder-prototype/), which is
  # the de facto spike/evidence record for this build.

files_to_change:
  - angular-bi/ (new Angular 19 standalone workspace)
  - angular-bi/src/app/core/* (API client, types, selection/cross-filter service)
  - angular-bi/src/app/features/data-sources/*
  - angular-bi/src/app/features/json-explorer/*
  - angular-bi/src/app/features/dashboard/*  (cross-filtering demo)
  - angular-bi/src/app/features/query-builder/* (Visual / Formula / AI-placeholder)
  - query-builder-prototype/server.js (extend: CORS for Angular dev server, a
    couple of read endpoints if the UI needs them — no change to the
    validation gate itself)
  - angular-bi/README.md (what's live vs. placeholder, how to run)

work_order:
  - 1. Scaffold Angular 19 standalone workspace with routing; strict TS.
  - 2. Core API client service (typed, environment-driven base URL) +
       shared TypeScript interfaces for sources/schema/query/measures.
  - 3. Data Sources feature: port the working sources.html page to Angular
       (live SQLite table/schema/preview) + placeholder cards for
       SQL Server / SAP / Google Sheets / REST, clearly marked "Not
       connected in this demo".
  - 4. JSON Explorer feature: client-side recursive flatten service (new,
       real) over a seeded nested-JSON demo record; matches the
       feasibility tracker's "flatten client-side" recommendation.
  - 5. Cross-filtering dashboard: 2 real charts (native SVG, no chart
       library dependency) sharing a SelectionService (RxJS
       BehaviorSubject) — click a bar in one chart, the other
       highlights/filters. This is the real, working version of item 06.
  - 6. Query Builder — Visual mode: port the working visual builder,
       calling the same validated /api/query endpoint.
  - 7. Query Builder — Formula mode: real parser (jsep) for arithmetic
       over already-computed measures (e.g. [Actual]/[Planned]); CALCULATE
       /filter-context explicitly out of scope — shown as a labeled
       roadmap placeholder, not faked.
  - 8. Query Builder — AI mode: explicit placeholder panel per instruction,
       no live backend call, visibly labeled "Demo placeholder".
  - 9. Custom Visual extensibility: real bar/line/pie chart-type switch
       (native SVG); "Import Custom Visual" affordance is a labeled
       placeholder (real plugin/Module Federation loading is out of scope).
  - 10. Filters panel: real field/operator/value filters + Group By
        (ports existing validated logic); a status chip list showing
        which of the tracker's 12 filter sub-types are live vs planned.
  - 11. Wire navigation/shell consistent with the earlier Tasnim Maps
        visual language; security/scalability pass (OnPush, typed HTTP,
        no innerHTML of unescaped user input, environment config).
  - 12. Build + lint clean; manual smoke test of every route against the
        live backend; independent review pass.

tests_to_write:
  - Unit: flatten service (nested object/array → flat rows; edge cases:
    empty object, array of primitives, deeply nested).
  - Unit: Formula-mode arithmetic parser (valid expression evaluates;
    unknown measure reference is rejected, not silently NaN'd).
  - No new backend tests needed — the validation gate is unchanged; the
    Express prototype's manual injection-attempt check already covers it.

risks:
  - Angular 19 CLI on Node 24 logs an "unsupported" warning; low risk —
    confirmed `ng version`/scaffold both succeed. Watch for real build
    failures, not the warning itself.
  - CORS: Angular dev server (4200) calling Express (4173) needs CORS
    enabled on the backend for local dev only.
  - Time-box: full Module Federation / real plugin loading is genuinely
    out of scope for one session — placeholder is the correct call per
    the tracker's own effort estimate on that item, not a shortcut taken
    to save time.

done_when:
  - `ng build` succeeds with no errors.
  - All 6 feature areas are reachable from navigation and render without
    console errors against the live backend.
  - Every non-live element carries a visible "Demo placeholder" marker.
  - Independent review pass finds no critical/high security findings
    (identifier validation, XSS via unescaped bindings, hardcoded secrets).
