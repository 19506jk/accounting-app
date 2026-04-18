import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DB_NAME = process.env.DB_NAME || 'test_db';
process.env.DB_USER = process.env.DB_USER || 'test_user';
process.env.DB_PASS = process.env.DB_PASS || 'test_pass';

let usersRouter: express.Router;

beforeAll(async () => {
  const mod = await import('../users.js');
  usersRouter = mod.default as unknown as express.Router;
});

async function requestUsers(
  method: 'GET',
  path: string,
  options?: { headers?: Record<string, string> },
) {
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}/api/users${path}`, {
    method,
    headers: options?.headers ?? {},
  });
  const json = await response.json();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return { status: response.status, body: json };
}

describe('users route access control', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'jwt-secret';
  });

  it('returns 403 for non-admin user hitting admin-only endpoint', async () => {
    const token = jwt.sign({ id: 2, email: 'viewer@example.com', role: 'viewer' }, 'jwt-secret');
    const res = await requestUsers('GET', '/', {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Access denied — requires role: admin' });
  });
});
