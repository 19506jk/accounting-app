import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const db = require('../db');

export function createAccessLogMiddleware(logDb = db) {
  return function accessLog(req: Request, res: Response, next: NextFunction) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

    const sessionToken = randomUUID();
    req.auditSessionToken = sessionToken;

    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      const result = originalJson(body);
      const status = res.statusCode;
      const outcome = status >= 200 && status < 300
        ? 'success'
        : status === 401 || status === 403
          ? 'unauthorized'
          : 'error';

      logDb('access_log').insert({
        session_token: sessionToken,
        actor_id: req.user?.id ?? null,
        actor_email: req.user?.email ?? null,
        request_method: req.method,
        request_path: req.path,
        ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
          ?? req.socket.remoteAddress
          ?? null,
        user_agent: req.headers['user-agent'] ?? null,
        http_status: status,
        outcome,
      }).catch((err: unknown) => console.error('[access-log] write failed:', err));

      return result;
    };

    next();
  };
}

export const accessLog = createAccessLogMiddleware();
