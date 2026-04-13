# accounting-app — Overview

> **Navigation aid.** This article shows WHERE things live (routes, models, files). Read actual source files before implementing new features or making changes.

**accounting-app** is a javascript project built with raw-http.

## Scale

7 middleware layers · 13 environment variables

## High-Impact Files

Changes to these files have the widest blast radius across the codebase:

- `client/src/api/client.ts` — imported by **14** files
- `client/src/components/ui/Button.jsx` — imported by **14** files
- `server/db/index.js` — imported by **13** files
- `client/src/context/AuthContext.tsx` — imported by **12** files
- `client/src/components/ui/Input.jsx` — imported by **12** files
- `client/src/utils/date.ts` — imported by **11** files

## Required Environment Variables

- `CLIENT_ORIGIN` — `server/index.ts`

---
_Back to [index.md](./index.md) · Generated 2026-04-13_