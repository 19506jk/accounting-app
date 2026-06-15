# Testing

The project uses Vitest for server unit tests and client browser-backed React tests.

## Server

Run these from `server/`:

```bash
pnpm run test
pnpm run test:coverage
pnpm run typecheck
pnpm run build
```

Server tests run in Vitest's Node environment. Unit tests should not start Express, bind a port, or connect to PostgreSQL.

## Client

Run these from `client/`:

```bash
pnpm run test
pnpm run test:coverage
pnpm run typecheck
pnpm run build
```

Client React tests use Vitest Browser Mode with Playwright Chromium. They do not use `jsdom`.

Before running client tests on a fresh machine or CI runner, install the browser and host dependencies:

```bash
pnpm exec playwright install chromium
sudo pnpm exec playwright install-deps chromium
```

In CI, run those Playwright setup commands before `pnpm run test` in `client/`.
