#!/bin/bash
set -e

# Run git pull and capture output
OUTPUT=$(git pull)

echo "$OUTPUT"

if echo "$OUTPUT" | grep -qE 'Already up[ -]to[ -]date\.?'; then
  echo "No updates detected. Aborting deployment."
  exit 0
fi

export COREPACK_HOME="${COREPACK_HOME:-$HOME/.cache/node/corepack}"
export PNPM_STORE_DIR="${PNPM_STORE_DIR:-$HOME/.local/share/pnpm/store}"

corepack pnpm install --frozen-lockfile
corepack pnpm -r --if-present run build
corepack pnpm --filter ./server run migrate -- --env production
corepack pnpm --filter ./server run seed -- --env production --specific=01_chart_of_accounts.js
corepack pnpm --filter ./server run seed -- --env production --specific=02_settings.js
corepack pnpm --filter ./server run seed -- --env production --specific=03_tax_rates.js
if pm2 describe accounting-app > /dev/null 2>&1; then
  pm2 delete accounting-app
fi
pm2 start server/ecosystem.config.cjs --update-env
pm2 save
