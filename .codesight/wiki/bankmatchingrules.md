# BankMatchingRules

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The BankMatchingRules subsystem handles **5 routes** and touches: auth, db.

## Routes

- `GET` `/api/bank-matching-rules` [auth, db] `[inferred]`
  `server/routes/bankMatchingRules.ts`
- `POST` `/api/bank-matching-rules` [auth, db] `[inferred]`
  `server/routes/bankMatchingRules.ts`
- `PUT` `/api/bank-matching-rules/:id` params(id) [auth, db] `[inferred]`
  `server/routes/bankMatchingRules.ts`
- `DELETE` `/api/bank-matching-rules/:id` params(id) [auth, db] `[inferred]`
  `server/routes/bankMatchingRules.ts`
- `POST` `/api/bank-matching-rules/simulate` [auth, db] `[inferred]`
  `server/routes/bankMatchingRules.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/bankMatchingRules.ts`

---
_Back to [overview.md](./overview.md)_