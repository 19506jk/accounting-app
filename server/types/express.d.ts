import type { AuthUser } from '@shared/contracts';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      auditSessionToken?: string;
    }
  }
}

export {};
