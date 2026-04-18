import express from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'development';
process.env.DB_NAME = process.env.DB_NAME || 'test_db';
process.env.DB_USER = process.env.DB_USER || 'test_user';
process.env.DB_PASS = process.env.DB_PASS || 'test_pass';

const verifyIdTokenMock = vi.fn();

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: verifyIdTokenMock,
  })),
}));
vi.mock('../middleware/auth.js', () => ((req: express.Request, _res: express.Response, next: express.NextFunction) => next()));

let authRouter: express.Router;

beforeAll(async () => {
  const mod = await import('../auth.js');
  authRouter = mod.default as unknown as express.Router;
});

async function requestAuth(
  method: 'GET' | 'POST',
  path: string,
  options?: { body?: unknown; headers?: Record<string, string> },
) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}/api/auth${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options?.headers ?? {}),
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = await response.json();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return { status: response.status, body: json };
}

describe('auth routes (no-db smoke)', () => {
  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.JWT_SECRET = 'jwt-secret';
    verifyIdTokenMock.mockReset();
  });

  afterEach(() => {
    process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    process.env.JWT_SECRET = originalJwtSecret;
  });

  it('returns 400 when google credential is missing', async () => {
    const res = await requestAuth('POST', '/google', { body: {} });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing credential' });
  });

  it('returns 401 when google token verification fails', async () => {
    verifyIdTokenMock.mockRejectedValue(new Error('bad token'));

    const res = await requestAuth('POST', '/google', {
      body: { credential: 'invalid-token' },
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid Google token' });
  });
});
