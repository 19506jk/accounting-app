declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: 'development' | 'production' | 'test';
    PORT?: string;
    DATABASE_URL?: string;
    DB_NAME?: string;
    DB_USER?: string;
    DB_PASS?: string;
    JWT_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    CLIENT_ORIGIN?: string;
  }
}
