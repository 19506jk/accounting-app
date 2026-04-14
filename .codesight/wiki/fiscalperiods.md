# FiscalPeriods

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The FiscalPeriods subsystem handles **4 routes** and touches: auth, db.

## Routes

- `POST` `/api/fiscal-periods/investigate` [auth, db] `[inferred]`
  `server/routes/fiscalPeriods.ts`
- `POST` `/api/fiscal-periods/close` [auth, db] `[inferred]`
  `server/routes/fiscalPeriods.ts`
- `GET` `/api/fiscal-periods` [auth, db] `[inferred]`
  `server/routes/fiscalPeriods.ts`
- `DELETE` `/api/fiscal-periods/:id/reopen` params(id) [auth, db] `[inferred]`
  `server/routes/fiscalPeriods.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/fiscalPeriods.ts`

---
_Back to [overview.md](./overview.md)_