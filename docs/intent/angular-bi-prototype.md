problem: Stakeholders need to see the 6 P-1 BI capabilities working end-to-end
  in Angular, against live data, to validate the feasibility conclusions and
  support a live demo — not just read about them in a tracker.
proposed_outcome: A running Angular application implementing the 6 P-1
  features (data connectivity, JSON flattening, DAX-like formula editor,
  custom visual extensibility, filters, cross-filtering) wired to the local
  SQLite source already built, with an explicit, clearly-labeled placeholder
  for anything not fully implemented (most notably AI mode, per direct
  instruction).
success_criteria:
  - All 6 features are visibly demoable in one running Angular app.
  - Every screen is either genuinely live (queries real SQLite data) or
    carries a visible "Demo placeholder" marker — nothing silently fakes data.
  - review date: 2026-09-14 (same session — this is a same-day prototype demo,
    reviewed immediately after build, not a scheduled follow-up).
assumptions:
  - Angular + a thin BFF (the already-built Express/SQLite backend) is a
    valid stand-in for the production Postgres/Cube.dev architecture already
    documented in the tracker. Validate: it already is — the Express
    prototype proved the metadata-validation-gate pattern against real
    SQLite queries this session.
  - The existing 200-row seeded `tasks`/`crews`/`equipment` schema is
    sufficient demo data for all 6 features. Risk if wrong: some feature
    demos look thin; low risk, low cost to reseed later.
affected_users: Internal stakeholders reviewing the feasibility study /
  demo audience. No production users, no real data.
constraints:
  - Must run entirely locally (no cloud deploy this session).
  - Must reuse the already-validated security pattern (schema-validated
    identifiers, parameterized values, never string-concatenated SQL).
  - Angular 19, standalone components — matches the stack already
    recommended in the feasibility tracker.
out_of_scope:
  - Real AI integration (explicit placeholder per instruction).
  - Real SAP/SQL Server/Sheets connectors (placeholder cards only).
  - CALCULATE-style filter-context propagation (documented as the hardest,
    highest-risk item in the tracker; a real implementation needs Cube.dev
    or equivalent — out of scope for a same-day local demo. Simple
    ratio/arithmetic formulas over already-computed measures ARE real.)
  - Auth, multi-tenant RLS, production deployment, CI/CD.
open_questions: none blocking — proceeding on existing session context.
