# Church Accounting App

Full-stack church accounting application with a React + Vite client and an Express + Knex API backed by PostgreSQL. This README covers local setup, day-to-day development, testing, and the minimum contributor workflow.

## Tech Stack

- Client: React 18, Vite, TypeScript, React Query
- Server: Express, Knex, TypeScript
- Database: PostgreSQL
- Testing: Vitest, Playwright, MSW

## Repo Layout

```text
client/   React + Vite frontend
server/   Express + Knex API
shared/   Code shared between client and server
docs/     Project documentation
```

The repo is a pnpm workspace with a root `package.json`, a single `pnpm-lock.yaml`,
and workspace packages in `client/`, `server/`, and `shared/`.

## Prerequisites

- Node 20 (`server/.nvmrc`)
- pnpm
- PostgreSQL running locally
- Google OAuth client ID(s) for local sign-in

## Installation

1. Clone the repo and enter it.

```bash
git clone <repository-url> accounting-app
cd accounting-app
```

2. Install dependencies for the workspace.

```bash
pnpm install
```

3. Copy the env templates and fill in your values.

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

4. Create the development and test PostgreSQL databases and a database user with access to both.

Suggested names from `server/.env.example`:
- Dev DB: `church_accounting_dev`
- Test DB: `church_accounting_test`
- User: `church_user`

5. Run migrations and seeds for local development.

```bash
cd server
pnpm run migrate
pnpm run seed
```

6. Set up the test database when you need server tests or Playwright E2E.

```bash
cd server
pnpm run migrate:test
pnpm run seed:test
```

Shortcut for a full reset:

```bash
cd server
pnpm run db:reset
pnpm run db:reset:test
```

7. Install Playwright Chromium before running client tests on a fresh machine.

```bash
cd client
pnpm exec playwright install chromium
sudo pnpm exec playwright install-deps chromium
```

## Running Locally

Start the API:

```bash
cd server
pnpm run dev
```

Start the client in a second terminal:

```bash
cd client
pnpm run dev
```

Open `http://localhost:5173`.

In local development, Vite proxies `/api` requests to `http://localhost:5000`.

Port convention used in this repo:

- Client Vite: `5173`
- Dev API: `5000`
- Test API: `5001`
- E2E Vite: `5174`
- Prod/pm2 API: `4000`

`AGENTS.md` mentions port `4000` for the server because that is the production/pm2 convention. Local `pnpm run dev` runs on `5000`.

## Environment Variables

Use the `.env.example` files as the source of truth. Do not commit `.env` files or real secrets.

### Server (`server/.env`)

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime environment |
| `PORT` | Express port; local template defaults to `4000`, while `pnpm run dev` overrides to `5000` |
| `DB_HOST` | PostgreSQL host for dev and test |
| `DB_PORT` | PostgreSQL port |
| `DB_NAME_DEV` | Development database name |
| `DB_USER_DEV` | Development database user |
| `DB_PASSWORD_DEV` | Development database password |
| `DB_NAME_TEST` | Test database name |
| `DB_USER_TEST` | Test database user |
| `DB_PASSWORD_TEST` | Test database password |
| `DATABASE_URL_PROD` | Production PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `GOOGLE_CLIENT_ID_DEV` | Google OAuth client ID for development |
| `GOOGLE_CLIENT_SECRET_DEV` | Google OAuth client secret for development |
| `GOOGLE_CLIENT_ID_PROD` | Google OAuth client ID for production |
| `GOOGLE_CLIENT_SECRET_PROD` | Google OAuth client secret for production |
| `GOOGLE_CLIENT_ID` | Optional backward-compatible fallback client ID |
| `CLIENT_ORIGIN` | Allowed client origin for CORS |

### Client (`client/.env`)

| Variable | Purpose |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID_DEV` | Google OAuth client ID for development |
| `VITE_GOOGLE_CLIENT_ID_PROD` | Google OAuth client ID for production |
| `VITE_GOOGLE_CLIENT_ID` | Optional backward-compatible fallback client ID |
| `VITE_API_BASE_URL` | Base API path; defaults to `/api` |

## Testing

See [docs/testing.md](docs/testing.md) for the project testing notes.

Server checks run from `server/`:

```bash
pnpm run typecheck
pnpm run test
pnpm run test:coverage
pnpm run build
```

Client checks run from `client/`:

```bash
pnpm run typecheck
pnpm run test
pnpm run test:coverage
pnpm run build
```

Playwright E2E runs from `client/`:

```bash
pnpm run e2e
pnpm run e2e:ui
pnpm run e2e:report
```

The E2E setup starts the test API on `5001` and the Vite app on `5174`.

## Contributing

Create a branch from `main`, make your changes, and open a pull request.

Before opening a PR, these commands should pass in both `server/` and `client/`:

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

Code-style summary:

- Use single quotes
- Avoid comments except JSDoc where needed
- Follow existing semicolon conventions: server uses them, client generally does not
- Keep naming consistent with the project: PascalCase for components, camelCase for functions and variables, UPPER_SNAKE_CASE for constants

For the full project conventions, architecture notes, and test conventions, see [AGENTS.md](AGENTS.md).

Common tasks:

- Add an API endpoint: create a route, add the service logic, and register the route in `server/index.ts`
- Add a page: create the page component, register the route in `client/src/App.tsx`, and add navigation if needed
- Add a migration: from `server/`, run `pnpm run knex -- migrate:make <name>`. From the repo root, use `pnpm --filter ./server run knex -- migrate:make <name>`. Then edit the generated file under `server/db/migrations/` and run `pnpm run migrate`.

## Deployment

Production deployment is driven by [deploy.sh](deploy.sh) and PM2 via [server/ecosystem.config.cjs](server/ecosystem.config.cjs).

By default, `./deploy.sh` stops after `git pull` when the repo is already up to date. Pass `--skip-update-check` (or `--force`) to continue the deploy steps anyway.

The current deploy flow is:

1. `git pull`
2. `pnpm install --frozen-lockfile`
3. `pnpm -r --if-present run build`
4. `pnpm --filter ./server run migrate -- --env production`
5. Run only these production seed files:
   `01_chart_of_accounts.js`, `02_settings.js`, `03_tax_rates.js`
6. Restart PM2 with `server/ecosystem.config.cjs`

Production deploys do not run the full seed set.
