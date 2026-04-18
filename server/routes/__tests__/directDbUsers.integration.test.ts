import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from '../routeTestHelpers.js';


dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdUserIds: number[] = [];

let usersRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const usersModule = await import('../users.js');
  usersRouter = usersModule.default as unknown as Router;
});

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db('users').whereIn('id', createdUserIds).delete();
    createdUserIds.length = 0;
  }
});

async function requestRoute({
  probePath,
  method,
  userId = 1,
  body,
}: {
  probePath: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  userId?: number;
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/users',
    probePath,
    method,
    router: usersRouter,
    userId,
    role: 'admin',
    body,
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

describe('direct DB users integration checks', () => {
  it('creates, lists, updates, deactivates, and deletes a pre-registered user', async () => {
    const suffix = uniqueSuffix();
    const email = `direct-user-${suffix}@example.com`;

    const created = await requestRoute({
      probePath: '/',
      method: 'POST',
      body: {
        email,
        role: 'viewer',
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.user).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: email,
      email,
      role: 'viewer',
      is_active: true,
    }));
    const userId = created.body.user.id as number;
    createdUserIds.push(userId);

    const listed = await requestRoute({
      probePath: '/',
      method: 'GET',
    });

    expect(listed.status).toBe(200);
    expect(listed.body.users).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: userId,
        email,
        role: 'viewer',
        is_active: true,
      }),
    ]));

    const roleUpdated = await requestRoute({
      probePath: `/${userId}/role`,
      method: 'PUT',
      body: {
        role: 'editor',
      },
    });

    expect(roleUpdated.status).toBe(200);
    expect(roleUpdated.body.user).toEqual(expect.objectContaining({
      id: userId,
      email,
      role: 'editor',
      is_active: true,
    }));

    const activeUpdated = await requestRoute({
      probePath: `/${userId}/active`,
      method: 'PUT',
      body: {
        is_active: false,
      },
    });

    expect(activeUpdated.status).toBe(200);
    expect(activeUpdated.body.user).toEqual(expect.objectContaining({
      id: userId,
      email,
      role: 'editor',
      is_active: false,
    }));

    const deleted = await requestRoute({
      probePath: `/${userId}`,
      method: 'DELETE',
    });

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ message: 'User deleted successfully' });
    createdUserIds.splice(createdUserIds.indexOf(userId), 1);

    const stored = await db('users').where({ id: userId }).first();
    expect(stored).toBeUndefined();
  });

  it('returns validation, conflict, not-found, and self-protection errors', async () => {
    const suffix = uniqueSuffix();
    const email = `direct-user-errors-${suffix}@example.com`;

    const missing = await requestRoute({
      probePath: '/',
      method: 'POST',
      body: {
        email,
      },
    });

    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ error: 'email and role are required' });

    const invalidRole = await requestRoute({
      probePath: '/',
      method: 'POST',
      body: {
        email,
        role: 'owner',
      },
    });

    expect(invalidRole.status).toBe(400);
    expect(invalidRole.body).toEqual({ error: 'Invalid role. Must be one of: admin, editor, viewer' });

    const existing = await requestRoute({
      probePath: '/',
      method: 'POST',
      body: {
        email,
        role: 'viewer',
      },
    });

    expect(existing.status).toBe(201);
    const userId = existing.body.user.id as number;
    createdUserIds.push(userId);

    const duplicate = await requestRoute({
      probePath: '/',
      method: 'POST',
      body: {
        email,
        role: 'viewer',
      },
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ error: 'A user with that email already exists' });

    const selfRole = await requestRoute({
      probePath: `/${userId}/role`,
      method: 'PUT',
      userId,
      body: {
        role: 'admin',
      },
    });

    expect(selfRole.status).toBe(400);
    expect(selfRole.body).toEqual({ error: 'You cannot change your own role' });

    const invalidActive = await requestRoute({
      probePath: `/${userId}/active`,
      method: 'PUT',
      body: {
        is_active: 'false',
      },
    });

    expect(invalidActive.status).toBe(400);
    expect(invalidActive.body).toEqual({ error: 'is_active must be a boolean' });

    const selfDeactivate = await requestRoute({
      probePath: `/${userId}/active`,
      method: 'PUT',
      userId,
      body: {
        is_active: false,
      },
    });

    expect(selfDeactivate.status).toBe(400);
    expect(selfDeactivate.body).toEqual({ error: 'You cannot deactivate your own account' });

    const selfDelete = await requestRoute({
      probePath: `/${userId}`,
      method: 'DELETE',
      userId,
    });

    expect(selfDelete.status).toBe(400);
    expect(selfDelete.body).toEqual({ error: 'You cannot delete your own account' });

    const notFound = await requestRoute({
      probePath: '/999999999',
      method: 'DELETE',
    });

    expect(notFound.status).toBe(404);
    expect(notFound.body).toEqual({ error: 'User not found' });
  });
});
