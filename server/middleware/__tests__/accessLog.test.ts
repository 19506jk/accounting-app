import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAccessLogMiddleware } from '../accessLog';

const dbMocks = {
  insert: vi.fn(),
  db: vi.fn(() => ({ insert: dbMocks.insert })),
};

function createRequest(method: string, overrides: Partial<Request> = {}): Request {
  return {
    method,
    path: '/api/bills/42/void',
    headers: {
      'user-agent': 'vitest-agent',
    },
    socket: {
      remoteAddress: '127.0.0.1',
    },
    ...overrides,
  } as Request;
}

function createResponse(statusCode: number) {
  return {
    statusCode,
    json: vi.fn().mockImplementation((body: unknown) => body),
  } as unknown as Response & {
    statusCode: number;
    json: ReturnType<typeof vi.fn>;
  };
}

describe('accessLog middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.insert.mockResolvedValue(undefined);
  });

  it('skips non-write methods and calls next without logging', () => {
    const req = createRequest('GET');
    const res = createResponse(200);
    const next = vi.fn() as NextFunction;
    const accessLog = createAccessLogMiddleware(dbMocks.db);

    accessLog(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auditSessionToken).toBeUndefined();
    expect(dbMocks.db).not.toHaveBeenCalled();
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it('sets session token and logs successful write responses', () => {
    const req = createRequest('POST', {
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
        'user-agent': 'vitest-agent',
      } as Request['headers'],
      user: {
        id: 7,
        email: 'admin@example.com',
        name: 'Admin',
        avatar_url: null,
        role: 'admin',
      },
    });
    const res = createResponse(201);
    const next = vi.fn() as NextFunction;
    const accessLog = createAccessLogMiddleware(dbMocks.db);

    accessLog(req, res, next);
    const payload = { ok: true };
    const result = res.json(payload);

    expect(next).toHaveBeenCalledTimes(1);
    expect(result).toEqual(payload);
    expect(req.auditSessionToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(dbMocks.db).toHaveBeenCalledWith('access_log');
    expect(dbMocks.insert).toHaveBeenCalledTimes(1);
    expect(dbMocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      session_token: req.auditSessionToken,
      actor_id: 7,
      actor_email: 'admin@example.com',
      request_method: 'POST',
      request_path: '/api/bills/42/void',
      ip_address: '203.0.113.10',
      user_agent: 'vitest-agent',
      http_status: 201,
      outcome: 'success',
    }));
  });

  it('maps 403 responses to unauthorized outcome', () => {
    const req = createRequest('DELETE');
    const res = createResponse(403);
    const next = vi.fn() as NextFunction;
    const accessLog = createAccessLogMiddleware(dbMocks.db);

    accessLog(req, res, next);
    res.json({ error: 'forbidden' });

    expect(dbMocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      actor_id: null,
      actor_email: null,
      http_status: 403,
      outcome: 'unauthorized',
    }));
  });

  it('maps 500 responses to error outcome', () => {
    const req = createRequest('PATCH');
    const res = createResponse(500);
    const next = vi.fn() as NextFunction;
    const accessLog = createAccessLogMiddleware(dbMocks.db);

    accessLog(req, res, next);
    res.json({ error: 'failure' });

    expect(dbMocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      http_status: 500,
      outcome: 'error',
    }));
  });
});
