# Settings

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Settings subsystem handles **2 routes** and touches: auth, db.

## Routes

- `GET` `/api/settings` [auth, db] `[inferred]`
  `server/routes/settings.ts`
- `PUT` `/api/settings` [auth, db] `[inferred]`
  `server/routes/settings.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/settings.ts`

---
_Back to [overview.md](./overview.md)_