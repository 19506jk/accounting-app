# accounting-app — Overview

> **Navigation aid.** This article shows WHERE things live (routes, models, files). Read actual source files before implementing new features or making changes.

**accounting-app** is a typescript project built with express, organized as a monorepo.

**Workspaces:** `church-accounting-client` (`client`), `church-accounting-server` (`server`)

## Scale

74 API routes · 35 UI components · 29 library files · 11 middleware layers · 13 environment variables

## Subsystems

- **[Auth](./auth.md)** — 2 routes — touches: auth, db
- **[*](./section.md)** — 1 routes — touches: auth, cache
- **[Accounts](./accounts.md)** — 5 routes — touches: auth, db
- **[Bills](./bills.md)** — 11 routes — touches: auth, db
- **[Contacts](./contacts.md)** — 10 routes — touches: auth, db, cache
- **[DonationReceipts](./donationreceipts.md)** — 5 routes — touches: auth
- **[FiscalPeriods](./fiscalperiods.md)** — 4 routes — touches: auth, db
- **[Funds](./funds.md)** — 5 routes — touches: auth, db
- **[Health](./health.md)** — 1 routes — touches: auth, cache
- **[Reconciliation](./reconciliation.md)** — 7 routes — touches: auth, db
- **[Reports](./reports.md)** — 6 routes — touches: auth
- **[Settings](./settings.md)** — 2 routes — touches: auth, db
- **[TaxRates](./taxrates.md)** — 3 routes — touches: auth, db
- **[Transactions](./transactions.md)** — 7 routes — touches: auth, db
- **[Users](./users.md)** — 5 routes — touches: auth, db

**UI:** 35 components (react) — see [ui.md](./ui.md)

**Libraries:** 29 files — see [libraries.md](./libraries.md)

## High-Impact Files

Changes to these files have the widest blast radius across the codebase:

- `server/db/index.js` — imported by **37** files
- `client/src/components/ui/types.ts` — imported by **26** files
- `client/src/components/ui/Button.tsx` — imported by **22** files
- `client/src/utils/date.ts` — imported by **19** files
- `client/src/api/client.ts` — imported by **17** files
- `client/src/components/ui/Input.tsx` — imported by **15** files

## Required Environment Variables

- `CLIENT_ORIGIN` — `server/index.ts`

---
_Back to [index.md](./index.md) · Generated 2026-04-18_