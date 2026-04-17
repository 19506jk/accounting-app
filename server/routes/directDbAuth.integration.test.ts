import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import jwt from 'jsonwebtoken';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestMountedRoute } from './routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'google-client-id';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const verifyIdTokenMock = vi.hoisted(() => vi.fn());

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: verifyIdTokenMock,
  })),
}));

const db = require('../db') as Knex;

const createdUserIds: number[] = [];

let authRouter: Router;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  await db.raw('select 1');

  const authModule = await import('./auth.js');
  authRouter = authModule.default as unknown as Router;
});

beforeEach(() => {
  verifyIdTokenMock.mockReset();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();

  if (createdUserIds.length > 0) {
    await db('users').whereIn('id', createdUserIds).delete();
    createdUserIds.length = 0;
  }
});

async function requestRoute({
  probePath,
  method,
  userId = 1,
  role = 'admin',
  body,
}: {
  probePath: string;
  method: 'GET' | 'POST';
  userId?: number;
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/auth',
    probePath,
    method,
    router: authRouter,
    userId,
    role,
    body,
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

describe('direct DB auth integration checks', () => {
  it('returns the active authenticated user from /me', async () => {
    const suffix = uniqueSuffix();
    const [user] = await db('users')
      .insert({
        google_id: `auth-me-${suffix}`,
        email: `auth-me-${suffix}@example.com`,
        name: `Auth Me ${suffix}`,
        avatar_url: `https://example.com/auth-me-${suffix}.png`,
        role: 'editor',
        is_active: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*') as Array<{ id: number }>;
    if (!user) throw new Error('Failed to create auth /me fixture user');
    createdUserIds.push(user.id);

    const res = await requestRoute({
      probePath: '/me',
      method: 'GET',
      userId: user.id,
      role: 'editor',
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(expect.objectContaining({
      id: user.id,
      email: `auth-me-${suffix}@example.com`,
      name: `Auth Me ${suffix}`,
      avatar_url: `https://example.com/auth-me-${suffix}.png`,
      role: 'editor',
      is_active: true,
    }));
  });

  it('rejects inactive or missing authenticated users from /me', async () => {
    const suffix = uniqueSuffix();
    const [inactiveUser] = await db('users')
      .insert({
        google_id: `auth-inactive-${suffix}`,
        email: `auth-inactive-${suffix}@example.com`,
        name: `Inactive Auth ${suffix}`,
        avatar_url: null,
        role: 'viewer',
        is_active: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*') as Array<{ id: number }>;
    if (!inactiveUser) throw new Error('Failed to create inactive auth fixture user');
    createdUserIds.push(inactiveUser.id);

    const inactive = await requestRoute({
      probePath: '/me',
      method: 'GET',
      userId: inactiveUser.id,
      role: 'viewer',
    });

    expect(inactive.status).toBe(403);
    expect(inactive.body).toEqual({ error: 'Account deactivated' });

    const missing = await requestRoute({
      probePath: '/me',
      method: 'GET',
      userId: 999999999,
      role: 'viewer',
    });

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'User not found' });
  });

  it('links a pre-registered user during Google sign-in and returns a JWT', async () => {
    const suffix = uniqueSuffix();
    const email = `pre-registered-auth-${suffix}@example.com`;
    const [preRegistered] = await db('users')
      .insert({
        google_id: null,
        email,
        name: email,
        avatar_url: null,
        role: 'viewer',
        is_active: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*') as Array<{ id: number }>;
    if (!preRegistered) throw new Error('Failed to create pre-registered auth fixture user');
    createdUserIds.push(preRegistered.id);

    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        sub: `google-auth-${suffix}`,
        email,
        name: `Google Auth ${suffix}`,
        picture: `https://example.com/google-auth-${suffix}.png`,
      }),
    });

    const res = await requestRoute({
      probePath: '/google',
      method: 'POST',
      body: {
        credential: `credential-${suffix}`,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(expect.objectContaining({
      id: preRegistered.id,
      email,
      role: 'viewer',
    }));
    expect(typeof res.body.token).toBe('string');
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET || 'jwt-secret')).toEqual(expect.objectContaining({
      id: preRegistered.id,
      email,
      role: 'viewer',
    }));
    expect(verifyIdTokenMock).toHaveBeenCalledWith({
      idToken: `credential-${suffix}`,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const stored = await db('users')
      .where({ id: preRegistered.id })
      .first() as { google_id: string | null; name: string; avatar_url: string | null; is_active: boolean } | undefined;

    expect(stored).toEqual(expect.objectContaining({
      google_id: `google-auth-${suffix}`,
      name: `Google Auth ${suffix}`,
      avatar_url: `https://example.com/google-auth-${suffix}.png`,
      is_active: true,
    }));
  });
});
