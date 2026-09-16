# Review Guide

## Merge Criteria
- All `CLAUDE.md` → Build & Test commands pass.
- Every spec invariant (`docs/specs/twise-bi-module.md`, I1–I7) has code that guarantees it and a test that would fail without it.
- Wells parity vectors from the intent reproduce exactly.

## Auto-block Triggers
- A client-supplied string concatenated into SQL, or a filter value that isn't a bound parameter.
- Secrets, `.env`, `*.db` or the Wells CSV added to git.
- A library file under `twise-bi/projects/tasnim-bi` importing from `host-harness` or `environments`.
- Existing test assertions weakened or deleted.
- Element, `body` or `:root` selectors in library styles.

## Always Check
- The visual query and See records use one filter-context builder (I3); the source visual is excluded from its own selection (I4).
- Requests are cancelled when superseded (I7); no nested subscribes without teardown.
- New UI states: loading, empty, error, and keyboard access.
- `sortBy` honoured wherever categories are ordered.

## Do Not Report
- Generated files, lockfiles, `dist/`, `.angular/`.
- The removed `angular-bi/` prototype; historical design notes under `docs/` are retained for traceability.
- Formatting already enforced by tooling.
