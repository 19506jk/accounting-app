#!/bin/bash
set -e
git pull
npm ci --prefix client
npm ci --prefix server
npm run build --prefix client
npm run migrate --prefix server -- --env production
npm run seed --prefix server -- --env production
pm2 restart accounting-app --update-env
