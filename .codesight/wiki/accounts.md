# Accounts

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Accounts subsystem handles **5 routes** and touches: auth, db.

## Routes

- `GET` `/api/accounts` [auth, db] `[inferred]`
  `server/routes/accounts.ts`
- `GET` `/api/accounts/:id` params(id) [auth, db] `[inferred]`
  `server/routes/accounts.ts`
- `POST` `/api/accounts` [auth, db] `[inferred]`
  `server/routes/accounts.ts`
- `PUT` `/api/accounts/:id` params(id) [auth, db] `[inferred]`
  `server/routes/accounts.ts`
- `DELETE` `/api/accounts/:id` params(id) [auth, db] `[inferred]`
  `server/routes/accounts.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/accounts.ts`

---
_Back to [overview.md](./overview.md)_