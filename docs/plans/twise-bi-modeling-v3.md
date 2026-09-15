date: 2026-09-15
research_trigger: full-tier
evidence: docs/spikes/twise-bi-modeling-v3.md
spec: docs/specs/twise-bi-modeling-v3.md

files_to_change:
  - twise-bi/projects/tasnim-bi/admin/src/data-sources.component.*   # D1
  - query-builder-prototype/bi/reports.js, bi/routes.js   # R2
  - twise-bi/projects/tasnim-bi/core/src/{contract,data-source,report-preferences}.ts   # R2, R3
  - twise-bi/projects/tasnim-bi/report/src/report-list.component.*   # R1
  - twise-bi/projects/tasnim-bi/modeling/** (new entry point)   # E1–E3, T3, T4
  - twise-bi/projects/tasnim-bi/report/src/{report,visualizations-pane}.component.*   # E1
  - twise-bi/projects/tasnim-bi/admin/src/measure-editor.component.*   # E2
  - query-builder-prototype/bi/transform/{steps,index}.js, bi/model.js, bi/connectors/index.js   # T1, T2, T4, E3
  - docs/api/bi-contract.openapi.yaml   # contract

work_order:
  - 1. D1 collapsible Data sources sections and Connections rail; browser check.
  - 2. R2 report metadata and categories (backend + contract tests); R3 preferences service; R1 Reports home rewrite; library specs; browser check.
  - 3. @tasnim/bi/modeling entry point; move the formula editor (E2); Data pane in report edit mode (E1); column properties API and UI (E3).
  - 4. Transformation engine backend: step registry and compiler (T2), query store, preview, apply with atomic swap, dependency order, refresh hook (T1), calendar source (T1), relationships manager API (T4); tests per step, injection, cycles, swap.
  - 5. Transform editor UI (T3) as page and full-screen editor from the report; relationships manager UI (T4); browser check building "Crew productivity".
  - 6. OpenAPI update, E2E guide update, independent QA, fixes.

tests_to_write:
  - Backend: one test per step type on an in-memory fixture (result rows and types), bound-value and injection tests, preview limits, apply swap and refusal to overwrite a source table, dependency re-apply after connector refresh, cycle refusal, calendar source, relationship key-uniqueness check, report metadata validation.
  - Library: report-list grouping / tabs / search / sort (pure helpers), preferences service, Data pane adds a field to the focused visual, transform step form serialization.

risks:
  - Scope is large; each work-order group lands separately so a partial stop leaves working software.
  - Pivot needs distinct values at compile time; capped at 50 columns and snapshotted at apply, as in Power Query.
  - Query tables have no foreign keys; relationships manager (T4) covers joins between them.

done_when:
  - Spec success criteria met, including the "Crew productivity" browser walk-through.
  - Backend, library and harness suites pass; harness production build within budget; check-evidence passes.
  - E2E guide updated with every new check.
