# BankTransactions

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The BankTransactions subsystem handles **17 routes** and touches: auth, db.

## Routes

- `POST` `/api/bank-transactions/import` [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `GET` `/api/bank-transactions` [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `GET` `/api/bank-transactions/uploads` [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `GET` `/api/bank-transactions/:id` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `PUT` `/api/bank-transactions/:id/review` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/scan` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/reserve` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/reject` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/release` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `DELETE` `/api/bank-transactions/:id/rejections` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/hold` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/release-hold` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/ignore` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/unignore` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/create` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/approve-match` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`
- `POST` `/api/bank-transactions/:id/override-match` params(id) [auth, db, upload] `[inferred]`
  `server/routes/bankTransactions.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/bankTransactions.ts`

---
_Back to [overview.md](./overview.md)_