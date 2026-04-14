# Funds

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Funds subsystem handles **5 routes** and touches: auth, db.

## Routes

- `GET` `/api/funds` [auth, db] `[inferred]`
  `server/routes/funds.ts`
- `GET` `/api/funds/:id` params(id) [auth, db] `[inferred]`
  `server/routes/funds.ts`
- `POST` `/api/funds` [auth, db] `[inferred]`
  `server/routes/funds.ts`
- `PUT` `/api/funds/:id` params(id) [auth, db] `[inferred]`
  `server/routes/funds.ts`
- `DELETE` `/api/funds/:id` params(id) [auth, db] `[inferred]`
  `server/routes/funds.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/funds.ts`

---
_Back to [overview.md](./overview.md)_