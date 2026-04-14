# Auth

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Auth subsystem handles **2 routes** and touches: auth, db.

## Routes

- `POST` `/api/auth/google` [auth, db] `[inferred]`
  `server/routes/auth.ts`
- `GET` `/api/auth/me` [auth, db] `[inferred]`
  `server/routes/auth.ts`

## Middleware

- **auth** (auth) — `server/middleware/auth.ts`
- **roles** (auth) — `server/middleware/roles.ts`
- **auth** (auth) — `server/routes/auth.ts`
- **authRoutes** (auth) — `server/index.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/auth.ts`

---
_Back to [overview.md](./overview.md)_