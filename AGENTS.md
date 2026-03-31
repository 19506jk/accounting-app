# Church Accounting App - Agent Guidelines

## Project Overview

Full-stack church accounting application with:
- **Client**: React + Vite (port 5173)
- **Server**: Express + Knex.js + PostgreSQL (port 4000)

## Build & Development Commands

### Client (`/client`)

```bash
npm run dev      # Start Vite dev server with HMR
npm run build    # Production build
npm run preview  # Preview production build
```

### Server (`/server`)

```bash
npm run dev              # Start with nodemon (auto-reload)
npm run start            # Production start
npm run migrate          # Run pending migrations
npm run migrate:status   # List migration status
npm run migrate:rollback # Rollback last migration
npm run seed             # Run seed files
npm run db:reset         # Full DB reset: rollback all + migrate + seed
```

### Running Single Tests

**No test framework configured.** To add tests:
- Client: Add Vitest (`npm install -D vitest @testing-library/react`)
- Server: Add Jest (`npm install -D jest`) or use Node's native test runner

## Code Style Guidelines

### General Conventions

- **No comments** except JSDoc for complex functions or critical explanations
- **No emojis** in code (comments in docs/UX acceptable)
- **Single quotes** for strings (consistent throughout codebase)
- **Semicolons**: Server uses them, client omits them - follow file convention
- **Trailing commas** in multi-line objects/arrays

### Imports

**Client (ESM):**
```jsx
import { useState } from 'react';
import { useAuth }    from './context/AuthContext';  // Group by type
import client         from '../api/client';
```

**Server (CommonJS):**
```javascript
const express = require('express');
const helmet  = require('helmet');  // Align related imports
const db      = require('../db');
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `ProtectedRoute`, `FullScreenSpinner` |
| Files | PascalCase (components), camelCase (utils) | `AuthContext.jsx`, `client.js` |
| Functions | camelCase | `getBalanceSheet`, `handleLogin` |
| Variables | camelCase | `isInitialLoading`, `totalIncome` |
| Constants | UPPER_SNAKE_CASE | `BASE_URL`, `JWT_SECRET` |
| Database tables | snake_case, plural | `journal_entries`, `chart_of_accounts` |
| DB columns | snake_case | `created_at`, `user_id` |

### File Organization

**Client:**
```
src/
  api/          - API client setup
  components/   - Reusable UI components
  context/      - React context providers
  pages/        - Route-level components
  main.jsx      - Entry point
  App.jsx       - Root component with routes
```

**Server:**
```
server/
  db/           - Migrations, seeds, knex setup
  middleware/   - Express middleware (auth)
  routes/       - Route handlers (one per resource)
  services/     - Business logic layer
  index.js      - Express app entry
  knexfile.js   - Knex configuration
```

### Component Patterns

**Client - Functional Components:**
```jsx
export default function ComponentName({ prop1, prop2 }) {
  // Hooks first
  const [state, setState] = useState(initialValue);
  
  // Callbacks with useCallback when needed
  const handler = useCallback(() => { ... }, [deps]);
  
  // Early returns for guards
  if (!condition) return null;
  
  return <JSX />;
}
```

**Server - Route Handlers:**
```javascript
router.get('/resource', auth, async (req, res, next) => {
  try {
    // Validate inputs early
    if (!param) return res.status(400).json({ error: 'Message' });
    
    // Business logic
    const result = await service.doWork(req.user.id);
    
    return res.json({ result });
  } catch (err) {
    next(err);  // Let global handler manage errors
  }
});
```

### Error Handling

**Server:**
- Use try/catch with `next(err)` for async route handlers
- Return specific HTTP status codes (400, 401, 403, 404, 500)
- Global error handler in `index.js` catches unhandled errors
- Log errors with `console.error(err)` before responding

**Client:**
- Axios interceptors handle 401 globally (clear auth, redirect to login)
- Use error boundaries for component-level errors
- Show user-friendly messages, log details to console

### Database Patterns

**Knex Usage:**
```javascript
// Use query builder, not raw SQL
const users = await db('users')
  .where({ is_active: true })
  .where('created_at', '>=', fromDate)
  .select('id', 'name', 'email')
  .orderBy('name', 'asc');

// For aggregates, use db.raw
db.raw('COALESCE(SUM(je.debit), 0) AS total_debit')

// Always use parameterized queries (Knex handles this)
```

**Money Handling:**
- Use `decimal.js` for all monetary calculations
- Never use native JavaScript numbers for currency
- Store as DECIMAL in PostgreSQL, convert to Decimal in JS

### Authentication

- Google OAuth for login (ID token verification)
- JWT for session (24h expiry)
- Token stored in localStorage (`church_token`)
- User data in localStorage (`church_user`)
- Middleware attaches `req.user` to authenticated requests

### Environment Variables

**Client (.env):**
- `VITE_GOOGLE_CLIENT_ID` - Google OAuth client ID
- `VITE_API_BASE_URL` - API base URL (default: `/api`)

**Server (.env):**
- `NODE_ENV` - environment (development/production)
- `PORT` - server port (default: 4000)
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret (use long random string)
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `CLIENT_ORIGIN` - allowed CORS origin

## Architecture Notes

- **Proxy**: Dev server proxies `/api` to Express (port 4000)
- **CORS**: Server configured for specific origins only
- **Security**: Helmet for security headers, HTTPS via Tailscale in production
- **State**: React Query for server state, Context for auth
- **Routing**: React Router v6 with nested protected routes

## Common Tasks

**Add new API endpoint:**
1. Create route in `server/routes/<resource>.js`
2. Add service function in `server/services/<resource>.js`
3. Register route in `server/index.js`
4. Add auth middleware if protected

**Add new page:**
1. Create component in `client/src/pages/<Page>.jsx`
2. Add route in `client/src/App.jsx`
3. Add to navigation in `client/src/components/Layout.jsx`

**Database migration:**
1. `npx knex migrate:make <description>`
2. Edit migration file in `db/migrations/`
3. `npm run migrate` to apply
