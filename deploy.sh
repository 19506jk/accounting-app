#!/bin/bash
set -e

# Run git pull and capture output
OUTPUT=$(git pull)

echo "$OUTPUT"

if echo "$OUTPUT" | grep -qE 'Already up[ -]to[ -]date\.?'; then
  echo "No updates detected. Aborting deployment."
  exit 0
fi

npm ci --prefix client
npm ci --prefix server
npm run build --prefix client
npm run build --prefix server
npm run migrate --prefix server -- --env production
npm run seed --prefix server -- --env production --specific=01_chart_of_accounts.js
npm run seed --prefix server -- --env production --specific=02_settings.js
npm run seed --prefix server -- --env production --specific=03_tax_rates.js
if pm2 describe accounting-app > /dev/null 2>&1; then
  pm2 delete accounting-app
fi
pm2 start server/ecosystem.config.cjs --update-env
pm2 save
