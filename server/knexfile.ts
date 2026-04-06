import 'dotenv/config';

import type { Knex } from 'knex';

const config: Record<string, Knex.Config> = {
  development: {
    client: 'postgresql',
    connection: {
      host: 'localhost',
      port: 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
    },
    migrations: {
      directory: './db/migrations',
      tableName: 'knex_migrations',
    },
    seeds: {
      directory: './db/seeds',
    },
  },
  production: {
    client: 'postgresql',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: false,
    },
    migrations: {
      directory: './db/migrations',
      tableName: 'knex_migrations',
    },
    seeds: {
      directory: './db/seeds',
    },
    pool: {
      min: 2,
      max: 10,
    },
  },
};

export default config;
