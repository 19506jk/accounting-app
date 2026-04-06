# TypeScript Migration Tracker

## Remaining JavaScript Modules

- `server/routes/reports.js`
- `server/routes/settings.js`
- `server/routes/taxRates.js`
- `server/services/bills.js` (intentional hold during current route-boundary migration)
- `server/services/reports.js` (paired with `server/routes/reports.js`)

## Route Conversion Guardrails

Before converting the remaining routes to TypeScript, preserve current runtime behavior for these edge cases:

- `settings` PUT currently coerces falsy values to `null` (`value || null`), including empty strings.
- `tax-rates` GET currently filters inactive rows unless `all` is truthy (`if (!all)` behavior).

Validate both behaviors before and after route conversion so any behavior change is explicit and intentional.

## Strictness Rollout

- `client` now runs with `"strict": true`, including `strictNullChecks` and `noUncheckedIndexedAccess`.
- `server` keeps `"strict": false` during mixed JS/TS migration, but now enables `strictNullChecks` and `noUncheckedIndexedAccess`.
- Planned follow-up: move `server` to full strict mode after route/service conversion and boundary cleanup.

### Server Strict Mode Boundary

- Keep database migrations and seeds in JavaScript for now (`server/db/migrations/**/*.js`, `server/db/seeds/**/*.js`, `server/db/utils.js`, `server/db/index.js`).
- Scope strict-mode completion to runtime app modules (`server/index.ts`, `server/middleware`, `server/routes`, `server/services`, `server/types`).

## Next Execution Order

1. Convert `server/routes/reports.js`, `server/routes/settings.js`, and `server/routes/taxRates.js` to TypeScript.
2. Convert `server/services/reports.js` to TypeScript.
3. Re-run behavior checks for `settings` PUT and `tax-rates` GET `all` handling.
4. Decide whether to migrate `server/services/bills.js` now or keep as an explicit deferred item.
5. Flip `server` to full strict mode for runtime modules (with DB JS boundary intact).
