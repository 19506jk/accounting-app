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
- Completed server strict-mode hardening for runtime TypeScript modules:
  - Set `server/tsconfig.json` to `"strict": true`
  - Removed runtime JS include globs from server tsconfig (`routes/**/*.js`, `services/**/*.js`, `middleware/**/*.js`)
  - Replaced Knex `this` callback usage with typed builder callbacks in strict-sensitive query paths
  - Removed runtime `any` from `server/routes`, `server/services`, and `server/middleware`
  - Added nullability guards for strict `.first()` handling in strict-sensitive mutation paths

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
- `server` now runs with `"strict": true` for runtime TypeScript modules.

### Server Strict Mode Boundary

- Keep database migrations and seeds in JavaScript for now (`server/db/migrations/**/*.js`, `server/db/seeds/**/*.js`, `server/db/utils.js`, `server/db/index.js`).
- Runtime app modules in scope for strict completion: `server/index.ts`, `server/middleware`, `server/routes`, `server/services`, `server/types`.
- Runtime strict boundary status: complete for current TypeScript runtime modules.

## Next Execution Order

1. Keep DB JS boundary unchanged unless a dedicated DB-layer migration is started.
2. Add regression coverage for `/api/bills/reports/aging` and auth-protected report/bill endpoints.
3. Optional future phase: evaluate TypeScript migration for DB runtime boundary (`server/db/index.js`, `server/db/utils.js`) separately from migrations/seeds.
