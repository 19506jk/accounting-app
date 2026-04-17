import express from 'express';
import jwt from 'jsonwebtoken';

import type { Role } from '@shared/contracts';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function buildTestToken(userId = 1, role: Role = 'admin') {
  return jwt.sign(
    { id: userId, email: `${role}-${userId}@example.com`, role },
    process.env.JWT_SECRET || 'jwt-secret',
  );
}

export async function requestMountedRoute({
  mountPath,
  probePath,
  method = 'GET',
  router,
  userId = 1,
  role = 'admin',
  body,
}: {
  mountPath: string;
  probePath: string;
  method?: Method;
  router: express.Router;
  userId?: number;
  role?: Role;
  body?: unknown;
}) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  app.use((err: Error & { status?: number; statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status || err.statusCode || 500).json({ error: err.message });
  });

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}${mountPath}${probePath}`, {
    method,
    headers: {
      authorization: `Bearer ${buildTestToken(userId, role)}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));

  return { status: response.status, body: json };
}
