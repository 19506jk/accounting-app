import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import requireRole from './roles';

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe('requireRole middleware', () => {
  it('rejects unauthenticated requests', () => {
    const req = {} as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    requireRole('admin')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthenticated' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects authenticated users without an allowed role', () => {
    const req = {
      user: {
        id: 7,
        email: 'viewer@example.com',
        name: 'Viewer',
        avatar_url: null,
        role: 'viewer',
      },
    } as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    requireRole('admin', 'editor')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Access denied — requires role: admin or editor',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows authenticated users with an allowed role', () => {
    const req = {
      user: {
        id: 7,
        email: 'editor@example.com',
        name: 'Editor',
        avatar_url: null,
        role: 'editor',
      },
    } as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    requireRole('admin', 'editor')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
