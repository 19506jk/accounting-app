# Reconciliation

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Reconciliation subsystem handles **9 routes** and touches: auth, db.

## Routes

- `GET` `/api/reconciliations` [auth, db, upload] `[inferred]`
  `server/routes/reconciliation.ts`
- `GET` `/api/reconciliations/:id` params(id) [auth, db, upload] `[inferred]`
  `server/routes/reconciliation.ts`
- `GET` `/api/reconciliations/:id/report` params(id) [auth, db, upload] `[inferred]`
  `server/routes/reconciliation.ts`
- `POST` `/api/reconciliations` [auth, db, upload] `[inferred]`
  `server/routes/reconciliation.ts`
- `PUT` `/api/reconciliations/:id` params(id) [auth, db, upload] `[inferred]`
  `server/routes/reconciliation.ts`
- `POST` `/api/reconciliations/:id/items/:itemId/clear` params(id, itemId) [auth, db, upload] `[inferred]`
  `server/routes/reconciliation.ts`
- `POST` `/api/reconciliations/:id/close` params(id) [auth, db, upload] `[inferred]`
  `server/routes/reconciliation.ts`
- `POST` `/api/reconciliations/:id/reopen` params(id) [auth, db, upload] `[inferred]`
  `server/routes/reconciliation.ts`
- `DELETE` `/api/reconciliations/:id` params(id) [auth, db, upload] `[inferred]`
  `server/routes/reconciliation.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/reconciliation.ts`

---
_Back to [overview.md](./overview.md)_