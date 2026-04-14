# Contacts

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Contacts subsystem handles **10 routes** and touches: auth, db, cache.

## Routes

- `GET` `/api/contacts` [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`
- `GET` `/api/contacts/receipts/bulk` [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`
- `GET` `/api/contacts/:id` params(id) [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`
- `POST` `/api/contacts` [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`
- `PUT` `/api/contacts/:id` params(id) [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`
- `PATCH` `/api/contacts/:id/deactivate` params(id) [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`
- `DELETE` `/api/contacts/:id` params(id) [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`
- `GET` `/api/contacts/:id/donations` params(id) [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`
- `GET` `/api/contacts/:id/donations/summary` params(id) [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`
- `GET` `/api/contacts/:id/receipt` params(id) [auth, db, cache] `[inferred]`
  `server/routes/contacts.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/contacts.ts`

---
_Back to [overview.md](./overview.md)_