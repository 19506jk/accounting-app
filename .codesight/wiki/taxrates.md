# TaxRates

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The TaxRates subsystem handles **3 routes** and touches: auth, db.

## Routes

- `GET` `/api/tax-rates` [auth, db] `[inferred]`
  `server/routes/taxRates.ts`
- `PUT` `/api/tax-rates/:id` params(id) [auth, db] `[inferred]`
  `server/routes/taxRates.ts`
- `PATCH` `/api/tax-rates/:id/toggle` params(id) [auth, db] `[inferred]`
  `server/routes/taxRates.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/taxRates.ts`

---
_Back to [overview.md](./overview.md)_