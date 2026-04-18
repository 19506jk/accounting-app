# DonationReceipts

> **Navigation aid.** Route list and file locations extracted via AST. Read the source files listed below before implementing or modifying this subsystem.

The DonationReceipts subsystem handles **5 routes** and touches: auth.

## Routes

- `GET` `/api/donation-receipts/accounts` [auth] `[inferred]`
  `server/routes/donationReceipts.ts`
- `GET` `/api/donation-receipts/template` [auth] `[inferred]`
  `server/routes/donationReceipts.ts`
- `PUT` `/api/donation-receipts/template` [auth] `[inferred]`
  `server/routes/donationReceipts.ts`
- `POST` `/api/donation-receipts/preview` [auth] `[inferred]`
  `server/routes/donationReceipts.ts`
- `POST` `/api/donation-receipts/generate-pdf` [auth] `[inferred]`
  `server/routes/donationReceipts.ts`

## Source Files

Read these before implementing or modifying this subsystem:
- `server/routes/donationReceipts.ts`

---
_Back to [overview.md](./overview.md)_