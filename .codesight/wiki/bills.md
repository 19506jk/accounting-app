# Bills

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The Bills subsystem handles **11 routes** and touches: auth, db.

## Routes

- `GET` `/api/bills` [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `GET` `/api/bills/summary` [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `GET` `/api/bills/reports/aging` [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `GET` `/api/bills/:id/available-credits` params(id) [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `POST` `/api/bills/:id/apply-credits` params(id) [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `POST` `/api/bills/:id/unapply-credits` params(id) [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `GET` `/api/bills/:id` params(id) [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `POST` `/api/bills` [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `PUT` `/api/bills/:id` params(id) [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `POST` `/api/bills/:id/pay` params(id) [auth, db] `[inferred]`
  `server/routes/bills.ts`
- `POST` `/api/bills/:id/void` params(id) [auth, db] `[inferred]`
  `server/routes/bills.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/bills.ts`

---
_Back to [overview.md](./overview.md)_