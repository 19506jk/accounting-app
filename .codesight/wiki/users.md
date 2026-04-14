# Users

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Users subsystem handles **5 routes** and touches: auth, db.

## Routes

- `POST` `/api/users` [auth, db] `[inferred]`
  `server/routes/users.ts`
- `GET` `/api/users` [auth, db] `[inferred]`
  `server/routes/users.ts`
- `PUT` `/api/users/:id/role` params(id) [auth, db] `[inferred]`
  `server/routes/users.ts`
- `PUT` `/api/users/:id/active` params(id) [auth, db] `[inferred]`
  `server/routes/users.ts`
- `DELETE` `/api/users/:id` params(id) [auth, db] `[inferred]`
  `server/routes/users.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/users.ts`

---
_Back to [overview.md](./overview.md)_