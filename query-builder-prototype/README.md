# Query Builder Prototype — local SQLite

A real, running proof of concept for the "Query Builder" feature from the
feasibility study: a Data Source Configuration page and a Visual query
builder wired to an actual local database — not a static mockup.

## What's real here

- **`data.db`** — a genuine SQLite file (via Node's built-in `node:sqlite`,
  no native module compile needed) with three tables: `crews`, `equipment`,
  `tasks` (200 seeded rows), plus a `measures` table that persists whatever
  you save from the builder.
- **`server.js`** — an Express API that reads the *live* schema
  (`PRAGMA table_info`) rather than hardcoding it, and only ever builds SQL
  from identifiers it has checked against that schema. Filter values are
  always bound parameters, never string-concatenated. This is the same
  metadata-validation-gate pattern documented for the production
  Postgres/RDS + Cube.dev design in the tracker — implemented here for real,
  against a real (if toy) database.
- **`public/sources.html`** — a genuine data-source config page: it reads
  `/api/sources`, so what it shows (tables, columns, row counts, a live
  preview) reflects the actual `data.db` file, not a hardcoded list.
- **`public/query-builder.html`** — the Visual mode from the mockup, wired
  up: pick a table, an aggregation or a ratio (SUM/AVG/COUNT/MIN/MAX,
  numerator ÷ denominator), a Group By, and filters — all populated from the
  real schema — then **Run Query** executes it against SQLite and renders
  the actual returned rows as bars. **Save Measure** persists the
  configuration to the `measures` table; **Load** brings it back.

## What's not wired (still the earlier static mockup)

Formula mode and AI mode are the Claude Design canvas screens from before —
this prototype only wires up Visual mode, plus the data source page. The
backend is plain HTML/JS/Express rather than Angular, to prove the concept
fastest; a real build would put the same REST API behind Angular services
(`HttpClient`) exactly as already documented in the feasibility tracker.

## Run it

```bash
cd query-builder-prototype
npm install
npm start
```

Then open `http://localhost:4173`. `data.db` is created and seeded
automatically on first run if it doesn't exist yet — delete the file to
reseed from scratch.
