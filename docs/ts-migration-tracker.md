# TypeScript Migration Tracker

## Remaining JavaScript Modules

- `server/services/bills.js` (intentional hold; only remaining runtime JS module)

## Completed In This Session

- Converted remaining server routes to TypeScript:
  - `server/routes/reports.ts`
  - `server/routes/settings.ts`
  - `server/routes/taxRates.ts`
- Converted reports service to TypeScript:
  - `server/services/reports.ts`

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

## Strictness Rollout

- `client` now runs with `"strict": true`, including `strictNullChecks` and `noUncheckedIndexedAccess`.
- `server` keeps `"strict": false` during mixed JS/TS migration, but now enables `strictNullChecks` and `noUncheckedIndexedAccess`.
- Planned follow-up: move `server` to full strict mode after route/service conversion and boundary cleanup.

### Server Strict Mode Boundary

- Keep database migrations and seeds in JavaScript for now (`server/db/migrations/**/*.js`, `server/db/seeds/**/*.js`, `server/db/utils.js`, `server/db/index.js`).
- Scope strict-mode completion to runtime app modules (`server/index.ts`, `server/middleware`, `server/routes`, `server/services`, `server/types`) with `server/services/bills.js` as the remaining runtime JS holdout.

## Next Execution Order

1. Decide and execute migration of `server/services/bills.js` to TypeScript (or formally defer with rationale).
2. Move server runtime modules to full strict mode (`"strict": true`) and resolve resulting type issues.
3. Keep DB migrations/seeds JS boundary unchanged unless a separate migration effort is started.
