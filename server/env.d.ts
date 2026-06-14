declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: 'development' | 'production' | 'test';
    PORT?: string;
    DB_HOST?: string;
    DB_PORT?: string;
    DB_USER_DEV?: string;
    DB_PASSWORD_DEV?: string;
    DB_NAME_DEV?: string;
    DB_USER_TEST?: string;
    DB_PASSWORD_TEST?: string;
    DB_NAME_TEST?: string;
    DATABASE_URL_PROD?: string;
    JWT_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    CLIENT_ORIGIN?: string;
  }
}
