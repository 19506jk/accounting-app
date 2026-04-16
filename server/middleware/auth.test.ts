import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';

import auth from './auth';

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe('auth middleware', () => {
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
    vi.restoreAllMocks();
  });

  it('rejects missing or malformed authorization headers', () => {
    const req = { headers: {} } as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing or malformed Authorization header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens', () => {
    process.env.JWT_SECRET = 'test-secret';
    const req = {
      headers: {
        authorization: 'Bearer not-a-token',
      },
    } as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects expired tokens with a specific message', () => {
    process.env.JWT_SECRET = 'test-secret';
    const token = jwt.sign(
      { id: 7, email: 'admin@example.com', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: -1 }
    );
    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    } as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token expired — please sign in again' });
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches the authenticated user and calls next for valid tokens', () => {
    process.env.JWT_SECRET = 'test-secret';
    const token = jwt.sign(
      { id: 7, email: 'admin@example.com', role: 'admin' },
      process.env.JWT_SECRET
    );
    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    } as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    auth(req, res, next);

    expect(req.user).toEqual({
      id: 7,
      email: 'admin@example.com',
      role: 'admin',
      name: '',
      avatar_url: null,
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
