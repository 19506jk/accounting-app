# TypeScript Migration Tracker

## Remaining JavaScript Modules

- Runtime app modules: none (all `server/routes` and `server/services` are now TypeScript).
- Intentional JavaScript boundary remains in DB layer only:
  - `server/db/index.js`
  - `server/db/utils.js`
  - `server/db/migrations/**/*.js`
  - `server/db/seeds/**/*.js`

## Completed In This Session

- Converted remaining server routes to TypeScript:
  - `server/routes/reports.ts`
  - `server/routes/settings.ts`
  - `server/routes/taxRates.ts`
- Converted reports service to TypeScript:
  - `server/services/reports.ts`
- Converted bills service to TypeScript:
  - `server/services/bills.ts`
- Updated bills route to consume typed service directly:
  - `server/routes/bills.ts`
- Aligned shared bills contracts to runtime summary/aging shapes:
  - `shared/contracts.ts`

## Behavior Changes Applied (Intentional)

- `settings` PUT now preserves empty strings via `value ?? null`.
- `tax-rates` GET now includes inactive rows only when `all=true`.

## Behavior Parity Verification

- Captured authenticated pre/post API snapshots for:
  - `/api/reports/pl`
  - `/api/reports/balance-sheet`
  - `/api/reports/ledger`
  - `/api/reports/trial-balance`
  - `/api/reports/donors/summary`
  - `/api/reports/donors/detail`
- Normalized diff result: all report responses matched post-conversion.
- Unauthorized smoke check (`/api/reports/pl`): status/body matched pre-conversion.

- Captured authenticated pre/post API snapshots for:
  - `/api/bills`
  - `/api/bills/:id`
  - `/api/bills/summary`
  - `/api/bills/reports/aging`
- Diff results:
  - `bills-list`, `bill-detail`, `summary`, and unauthorized checks matched.
  - `aging` differed because pre-conversion returned an error payload (`vendor_aging is not defined`) and post-conversion now returns the intended report structure.

## Strictness Rollout

- `client` now runs with `"strict": true`, including `strictNullChecks` and `noUncheckedIndexedAccess`.
- `server` keeps `"strict": false` during mixed JS/TS migration, but now enables `strictNullChecks` and `noUncheckedIndexedAccess`.
- Planned follow-up: move `server` to full strict mode after route/service conversion and boundary cleanup.

### Server Strict Mode Boundary

- Keep database migrations and seeds in JavaScript for now (`server/db/migrations/**/*.js`, `server/db/seeds/**/*.js`, `server/db/utils.js`, `server/db/index.js`).
- Runtime app modules in scope for strict completion: `server/index.ts`, `server/middleware`, `server/routes`, `server/services`, `server/types`.

## Next Execution Order

1. Flip `server` runtime modules to full strict mode (`"strict": true`) and resolve resulting issues.
2. Keep DB JS boundary unchanged unless a dedicated DB-layer migration is started.
3. Optional follow-up: decide whether to keep the `/api/bills/reports/aging` bug fix as-is (recommended) and add regression coverage for that endpoint.
