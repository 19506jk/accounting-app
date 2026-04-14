# Transactions

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Transactions subsystem handles **7 routes** and touches: auth, db, queue.

## Routes

- `GET` `/api/transactions` [auth, db, queue] `[inferred]`
  `server/routes/transactions.ts`
- `POST` `/api/transactions/import/bill-matches` [auth, db, queue] `[inferred]`
  `server/routes/transactions.ts`
- `POST` `/api/transactions/import` [auth, db, queue] `[inferred]`
  `server/routes/transactions.ts`
- `GET` `/api/transactions/:id` params(id) [auth, db, queue] `[inferred]`
  `server/routes/transactions.ts`
- `POST` `/api/transactions` [auth, db, queue] `[inferred]`
  `server/routes/transactions.ts`
- `PUT` `/api/transactions/:id` params(id) [auth, db, queue] `[inferred]`
  `server/routes/transactions.ts`
- `DELETE` `/api/transactions/:id` params(id) [auth, db, queue] `[inferred]`
  `server/routes/transactions.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/transactions.ts`

---
_Back to [overview.md](./overview.md)_