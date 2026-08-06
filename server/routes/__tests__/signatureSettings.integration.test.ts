import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requestMountedRoute } from '../routeTestHelpers.js';
import {
  TINY_JPEG_DATA_URI,
  TINY_PNG_DATA_URI,
  jpegBytes,
  pngBytes,
  pngDataUri,
} from '../../utils/signatureImageFixtures.js';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const SIGNER_KEYS = ['church_signature_url', 'branch_accountant_name', 'treasurer_name', 'treasurer_signature_url'];

let settingsRouter: Router;
const originalValues = new Map<string, string | null>();

beforeAll(async () => {
  const [settingsModule] = await Promise.all([import('../settings.js')]);
  settingsRouter = settingsModule.default as unknown as Router;

  // The signer keys come from migration 039 / the settings seed; ensure they
  // exist regardless of when the test database was last reset.
  for (const key of SIGNER_KEYS) {
    const existing = await db('settings').where({ key }).first() as { value: string | null } | undefined;
    originalValues.set(key, existing?.value ?? null);
    if (!existing) {
      await db('settings').insert({
        key,
        label: key,
        value: null,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    }
  }
});

afterAll(async () => {
  for (const key of SIGNER_KEYS) {
    await db('settings').where({ key }).update({ value: originalValues.get(key) ?? null, updated_at: db.fn.now() });
  }
});

function putSettings(body: Record<string, unknown>, role: 'admin' | 'editor' = 'admin') {
  return requestMountedRoute({
    mountPath: '/api/settings',
    probePath: '/',
    method: 'PUT',
    router: settingsRouter,
    role,
    body,
  });
}

async function storedValue(key: string): Promise<string | null> {
  const row = await db('settings').where({ key }).first() as { value: string | null } | undefined;
  return row?.value ?? null;
}

describe('signature settings updates', () => {
  it('stores a valid PNG data URI for the branch accountant signature', async () => {
    const res = await putSettings({ church_signature_url: TINY_PNG_DATA_URI });
    expect(res.status).toBe(200);
    expect(res.body.values?.church_signature_url).toBe(TINY_PNG_DATA_URI);
    expect(await storedValue('church_signature_url')).toBe(TINY_PNG_DATA_URI);
  });

  it('stores a valid JPEG data URI for the treasurer signature', async () => {
    const res = await putSettings({ treasurer_signature_url: TINY_JPEG_DATA_URI });
    expect(res.status).toBe(200);
    expect(res.body.values?.treasurer_signature_url).toBe(TINY_JPEG_DATA_URI);
    expect(await storedValue('treasurer_signature_url')).toBe(TINY_JPEG_DATA_URI);
  });

  it('stores both signature images and the signer names in one save', async () => {
    const res = await putSettings({
      church_signature_url: TINY_PNG_DATA_URI,
      treasurer_signature_url: TINY_JPEG_DATA_URI,
      branch_accountant_name: 'Jane Accountant',
      treasurer_name: 'Tom Treasurer',
    });
    expect(res.status).toBe(200);
    expect(res.body.values?.branch_accountant_name).toBe('Jane Accountant');
    expect(res.body.values?.treasurer_name).toBe('Tom Treasurer');
    expect(await storedValue('treasurer_signature_url')).toBe(TINY_JPEG_DATA_URI);
    expect(await storedValue('branch_accountant_name')).toBe('Jane Accountant');
  });

  it('clears a signature by submitting null', async () => {
    await putSettings({ church_signature_url: TINY_PNG_DATA_URI });
    const res = await putSettings({ church_signature_url: null });
    expect(res.status).toBe(200);
    expect(res.body.values?.church_signature_url).toBeNull();
    expect(await storedValue('church_signature_url')).toBeNull();
  });

  it('rejects newly supplied remote URLs without mutating anything', async () => {
    await putSettings({ church_signature_url: TINY_PNG_DATA_URI });
    const res = await putSettings({
      church_signature_url: 'https://example.com/signature.png',
      branch_accountant_name: 'should not save',
    });
    expect(res.status).toBe(400);
    expect(await storedValue('church_signature_url')).toBe(TINY_PNG_DATA_URI);
    expect(await storedValue('branch_accountant_name')).not.toBe('should not save');
  });

  it('rejects malformed, mismatched, and oversized payloads with no update', async () => {
    await putSettings({ church_signature_url: null }); // start from a cleared state
    const malformed = await putSettings({ church_signature_url: 'data:image/png;base64,@@@' });
    expect(malformed.status).toBe(400);

    const mismatched = await putSettings({
      church_signature_url: `data:image/png;base64,${jpegBytes(10, 10).toString('base64')}`,
    });
    expect(mismatched.status).toBe(400);

    const oversized = await putSettings({
      church_signature_url: `data:image/png;base64,${Buffer.alloc(250 * 1024 + 1).toString('base64')}`,
    });
    expect(oversized.status).toBe(400);

    const tooBig = await putSettings({ church_signature_url: pngDataUri(1700, 100) });
    expect(tooBig.status).toBe(400);

    // Header-only payloads pass magic-byte checks but carry no image data;
    // they must not be storable or they would break preview/PDF rendering.
    const headerOnlyPng = await putSettings({ church_signature_url: pngDataUri(10, 10) });
    expect(headerOnlyPng.status).toBe(400);
    const headerOnlyJpeg = await putSettings({
      church_signature_url: `data:image/jpeg;base64,${jpegBytes(10, 10).toString('base64')}`,
    });
    expect(headerOnlyJpeg.status).toBe(400);

    expect(await storedValue('church_signature_url')).toBeNull();
  });

  it('coerces an unchanged stored legacy URL to null while saving the rest of the form', async () => {
    const legacy = 'https://old.example.com/signature.png';
    await db('settings').where({ key: 'church_signature_url' }).update({ value: legacy, updated_at: db.fn.now() });

    const res = await putSettings({
      church_signature_url: legacy,
      branch_accountant_name: 'Coerced Save',
    });
    expect(res.status).toBe(200);
    expect(res.body.values?.church_signature_url).toBeNull();
    expect(res.body.values?.branch_accountant_name).toBe('Coerced Save');
    expect(await storedValue('church_signature_url')).toBeNull();
    expect(await storedValue('branch_accountant_name')).toBe('Coerced Save');
  });

  it('rejects a changed remote URL atomically, keeping the legacy value', async () => {
    const legacy = 'https://old.example.com/signature.png';
    await db('settings').where({ key: 'church_signature_url' }).update({ value: legacy, updated_at: db.fn.now() });

    const res = await putSettings({
      church_signature_url: 'https://different.example.com/signature.png',
      branch_accountant_name: 'must not save',
    });
    expect(res.status).toBe(400);
    expect(await storedValue('church_signature_url')).toBe(legacy);
    expect(await storedValue('branch_accountant_name')).not.toBe('must not save');
  });

  it('rejects a malformed PNG truncation with no update', async () => {
    await putSettings({ church_signature_url: null }); // start from a cleared state
    const truncated = pngBytes(10, 10).subarray(0, 10);
    const res = await putSettings({ church_signature_url: `data:image/png;base64,${truncated.toString('base64')}` });
    expect(res.status).toBe(400);
    expect(await storedValue('church_signature_url')).toBeNull();
  });

  it('rejects signature updates from non-admin users', async () => {
    const res = await putSettings({ church_signature_url: TINY_PNG_DATA_URI }, 'editor');
    expect(res.status).toBe(403);
    expect(await storedValue('church_signature_url')).toBeNull();
  });
});
