# Reports

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Reports subsystem handles **6 routes** and touches: auth.

## Routes

- `GET` `/api/reports/pl` [auth] `[inferred]`
  `server/routes/reports.ts`
- `GET` `/api/reports/balance-sheet` [auth] `[inferred]`
  `server/routes/reports.ts`
- `GET` `/api/reports/ledger` [auth] `[inferred]`
  `server/routes/reports.ts`
- `GET` `/api/reports/trial-balance` [auth] `[inferred]`
  `server/routes/reports.ts`
- `GET` `/api/reports/donors/summary` [auth] `[inferred]`
  `server/routes/reports.ts`
- `GET` `/api/reports/donors/detail` [auth] `[inferred]`
  `server/routes/reports.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/reports.ts`

---
_Back to [overview.md](./overview.md)_