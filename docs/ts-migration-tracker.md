# TypeScript Migration Tracker

## Remaining JavaScript Modules

- `server/services/bills.js` remains in JavaScript by design during route-boundary typing migration.
- Planned follow-up: migrate `server/services/bills.js` to TypeScript after remaining route/module conversion is complete.

## Strictness Rollout

- `client` now runs with `"strict": true`, including `strictNullChecks` and `noUncheckedIndexedAccess`.
- `server` keeps `"strict": false` during mixed JS/TS migration, but now enables `strictNullChecks` and `noUncheckedIndexedAccess`.
- Planned follow-up: move `server` to full strict mode after remaining JS modules are converted and narrowed.
