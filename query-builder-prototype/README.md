# Query Builder Prototype BI API

This is the local reference implementation of the `/api/bi` contract used by
`@tasnim/bi`. It is an Express service backed by Node's built-in SQLite API;
it is not a browser-only mock.

## Run

```powershell
npm install
npm start
# http://localhost:4173
```

The service loads `.env` when present. Copy `.env.example` if you need a
stable `CONNECTION_SECRET_KEY` or a custom outbound REST allow-list. The
default local data and connection stores are created on demand. Optional
seeding commands are available from the repository root:

```powershell
npm --prefix query-builder-prototype run seed:wells
npm --prefix query-builder-prototype run seed:appmaster
```

## Responsibilities

- Model metadata and safe query compilation for `/models`, `/query`, `/rows`,
  and `/values`.
- DAX-like formula validation, preview, measures, and calculated columns.
- Typed connections: SQLite, CSV, Excel, REST JSON, Google Sheets/Drive,
  SAP/ERP OData, SQL Server/AppMasterDB, and PostgreSQL.
- JSON ingestion and JSON-column flattening into typed tables with foreign-key
  links for arrays.
- Report/category persistence, dataset filters, connector refresh scheduling,
  and sandboxed custom visual catalog/import.

Each non-SQLite connection owns a file in `connections/`; the API lands or
refreshes source data there so the model/query contract stays consistent.
SQL Server and PostgreSQL drivers are optional. A missing driver is reported
as a setup requirement instead of crashing the service.

## Tests

```powershell
npm test
```

The suite covers connector setup/refresh, CSV/Excel, JSON flattening, formula
compilation, filters, cross-filter/highlight semantics, plug-ins, report
metadata, SSRF controls, and query performance. The expected result is 108
passing tests.

The API contract is documented in `../docs/api/bi-contract.openapi.yaml`.
The service is replaceable by a production tenant API as long as that
contract remains compatible.
