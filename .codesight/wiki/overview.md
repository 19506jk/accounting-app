# accounting-app — Overview

> **Navigation aid.** This article shows WHERE things live (routes, models, files). Read actual source files before implementing new features or making changes.

**accounting-app** is a typescript project built with express, organized as a monorepo.

**Workspaces:** `church-accounting-client` (`client`), `church-accounting-server` (`server`)

## Scale

94 API routes · 40 UI components · 37 library files · 11 middleware layers · 21 environment variables

## Subsystems

- **[Auth](./auth.md)** — 3 routes — touches: auth, db, upload
- **[*](./section.md)** — 1 routes — touches: auth, cache
- **[Accounts](./accounts.md)** — 5 routes — touches: auth, db
- **[BankTransactions](./banktransactions.md)** — 17 routes — touches: auth, db, upload
- **[Bills](./bills.md)** — 11 routes — touches: auth, db
- **[Contacts](./contacts.md)** — 10 routes — touches: auth, db, cache
- **[DonationReceipts](./donationreceipts.md)** — 5 routes — touches: auth
- **[FiscalPeriods](./fiscalperiods.md)** — 4 routes — touches: auth, db
- **[Funds](./funds.md)** — 5 routes — touches: auth, db
- **[Health](./health.md)** — 1 routes — touches: auth, cache
- **[Reconciliation](./reconciliation.md)** — 9 routes — touches: auth, db, upload
- **[Reports](./reports.md)** — 6 routes — touches: auth
- **[Settings](./settings.md)** — 2 routes — touches: auth, db
- **[TaxRates](./taxrates.md)** — 3 routes — touches: auth, db
- **[Transactions](./transactions.md)** — 7 routes — touches: auth, db
- **[Users](./users.md)** — 5 routes — touches: auth, db

**UI:** 40 components (react) — see [ui.md](./ui.md)

**Libraries:** 37 files — see [libraries.md](./libraries.md)

## High-Impact Files

Changes to these files have the widest blast radius across the codebase:

- `server/db/index.js` — imported by **45** files
- `client/src/components/ui/types.ts` — imported by **29** files
- `client/src/components/ui/Button.tsx` — imported by **27** files
- `client/src/utils/date.ts` — imported by **19** files
- `client/src/utils/errors.ts` — imported by **19** files
- `client/src/api/client.ts` — imported by **18** files

## Required Environment Variables

- `CLIENT_ORIGIN` — `server/index.ts`
- `DB_NAME` — `server/routes/__tests__/auth.test.ts`
- `DB_PASS` — `server/routes/__tests__/auth.test.ts`
- `DB_USER` — `server/routes/__tests__/auth.test.ts`

---
_Back to [index.md](./index.md) · Generated 2026-04-21_