#!/bin/bash
set -e
git pull
npm ci --prefix client
npm ci --prefix server
npm run build --prefix client
npx knex migrate:latest --knexfile server/knexfile.js
pm2 restart accounting-app --update-env
