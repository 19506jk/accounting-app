const knex = require('knex');
require('dotenv').config();

const config = {
  development: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME_DEV,
      user: process.env.DB_USER_DEV,
      password: String(process.env.DB_PASSWORD_DEV),
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
      connectionString: process.env.DATABASE_URL_PROD,
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
  test: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME_TEST,
      user: process.env.DB_USER_TEST,
      password: String(process.env.DB_PASSWORD_TEST),
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

const env = process.env.NODE_ENV || 'development';
if (env === 'test' && !process.env.DB_NAME_TEST) {
  throw new Error('DB_NAME_TEST must be set when NODE_ENV=test');
}

const db = knex(config[env]);

module.exports = db;
