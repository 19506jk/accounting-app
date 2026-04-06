#!/bin/bash
set -e
git pull
npm ci --prefix client
npm ci --prefix server
npm run build --prefix client
npm run migrate --prefix server -- --env production
npm run seed --prefix server -- --env production --specific=01_chart_of_accounts.js
npm run seed --prefix server -- --env production --specific=02_settings.js
npm run seed --prefix server -- --env production --specific=03_tax_rates.js
pm2 restart accounting-app --update-env
