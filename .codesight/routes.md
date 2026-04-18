# Routes

## CRUD Resources

- **`/api/accounts`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Account
- **`/api/bills`** GET | POST | GET/:id | PUT/:id → Bill
- **`/api/contacts`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Contact
- **`/api/funds`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Fund
- **`/api/reconciliations`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Reconciliation
- **`/api/transactions`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Transaction
- **`/api/users`** GET | POST | GET/:id | DELETE/:id → User

## Other Routes

- `GET` `/api/health` [auth, cache] `[inferred]`
- `GET` `*` [auth, cache] `[inferred]` ✓
- `POST` `/api/auth/google` [auth, db] `[inferred]` ✓
- `GET` `/api/auth/me` [auth, db] `[inferred]` ✓
- `GET` `/api/bills/summary` [auth, db] `[inferred]`
- `GET` `/api/bills/reports/aging` [auth, db] `[inferred]`
- `GET` `/api/bills/:id/available-credits` params(id) [auth, db] `[inferred]`
- `POST` `/api/bills/:id/apply-credits` params(id) [auth, db] `[inferred]`
- `POST` `/api/bills/:id/unapply-credits` params(id) [auth, db] `[inferred]`
- `POST` `/api/bills/:id/pay` params(id) [auth, db] `[inferred]`
- `POST` `/api/bills/:id/void` params(id) [auth, db] `[inferred]`
- `GET` `/api/contacts/receipts/bulk` [auth, db, cache] `[inferred]`
- `PATCH` `/api/contacts/:id/deactivate` params(id) [auth, db, cache] `[inferred]`
- `GET` `/api/contacts/:id/donations` params(id) [auth, db, cache] `[inferred]`
- `GET` `/api/contacts/:id/donations/summary` params(id) [auth, db, cache] `[inferred]`
- `GET` `/api/contacts/:id/receipt` params(id) [auth, db, cache] `[inferred]`
- `GET` `/api/donation-receipts/accounts` [auth] `[inferred]`
- `GET` `/api/donation-receipts/template` [auth] `[inferred]`
- `PUT` `/api/donation-receipts/template` [auth] `[inferred]`
- `POST` `/api/donation-receipts/preview` [auth] `[inferred]`
- `POST` `/api/donation-receipts/generate-pdf` [auth] `[inferred]`
- `POST` `/api/fiscal-periods/investigate` [auth, db] `[inferred]`
- `POST` `/api/fiscal-periods/close` [auth, db] `[inferred]`
- `GET` `/api/fiscal-periods` [auth, db] `[inferred]` ✓
- `DELETE` `/api/fiscal-periods/:id/reopen` params(id) [auth, db] `[inferred]`
- `GET` `/api/reconciliations/:id/report` params(id) [auth, db] `[inferred]`
- `POST` `/api/reconciliations/:id/items/:itemId/clear` params(id, itemId) [auth, db] `[inferred]`
- `POST` `/api/reconciliations/:id/close` params(id) [auth, db] `[inferred]`
- `GET` `/api/reports/pl` [auth] `[inferred]` ✓
- `GET` `/api/reports/balance-sheet` [auth] `[inferred]` ✓
- `GET` `/api/reports/ledger` [auth] `[inferred]` ✓
- `GET` `/api/reports/trial-balance` [auth] `[inferred]` ✓
- `GET` `/api/reports/donors/summary` [auth] `[inferred]` ✓
- `GET` `/api/reports/donors/detail` [auth] `[inferred]` ✓
- `GET` `/api/settings` [auth, db] `[inferred]` ✓
- `PUT` `/api/settings` [auth, db] `[inferred]` ✓
- `GET` `/api/tax-rates` [auth, db] `[inferred]` ✓
- `PUT` `/api/tax-rates/:id` params(id) [auth, db] `[inferred]`
- `PATCH` `/api/tax-rates/:id/toggle` params(id) [auth, db] `[inferred]`
- `POST` `/api/transactions/import/bill-matches` [auth, db] `[inferred]`
- `POST` `/api/transactions/import` [auth, db] `[inferred]`
- `PUT` `/api/users/:id/role` params(id) [auth, db] `[inferred]`
- `PUT` `/api/users/:id/active` params(id) [auth, db] `[inferred]`
