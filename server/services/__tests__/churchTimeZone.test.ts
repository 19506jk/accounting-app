import dotenv from 'dotenv';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_CHURCH_TIMEZONE } from '../../utils/date.js';

process.env.NODE_ENV = 'development';

dotenv.config();

const db = require('../../db') as Knex;

const SETTING_KEY = 'church_timezone';

let getChurchTimeZone: typeof import('../churchTimeZone.js').getChurchTimeZone;
let setChurchTimeZone: typeof import('../churchTimeZone.js').setChurchTimeZone;
let initializeChurchTimeZoneCache: typeof import('../churchTimeZone.js').initializeChurchTimeZoneCache;
let originalSetting: { value: string | null; label: string } | null = null;

beforeAll(async () => {
  const service = await import('../churchTimeZone.js');
  getChurchTimeZone = service.getChurchTimeZone;
  setChurchTimeZone = service.setChurchTimeZone;
  initializeChurchTimeZoneCache = service.initializeChurchTimeZoneCache;

  const row = await db('settings')
    .where({ key: SETTING_KEY })
    .select('value', 'label')
    .first() as { value: string | null; label: string } | undefined;
  originalSetting = row ?? null;
});

afterAll(async () => {
  if (originalSetting) {
    await db('settings')
      .where({ key: SETTING_KEY })
      .update({
        value: originalSetting.value,
        label: originalSetting.label,
        updated_at: db.fn.now(),
      });
  } else {
    await db('settings').where({ key: SETTING_KEY }).delete();
  }

  setChurchTimeZone(originalSetting?.value ?? null);
});

describe('church timezone cache', () => {
  it('sets valid time zones and falls back to the default for invalid values', () => {
    expect(setChurchTimeZone('America/Vancouver')).toBe('America/Vancouver');
    expect(getChurchTimeZone()).toBe('America/Vancouver');

    expect(setChurchTimeZone('Not/AZone')).toBe(DEFAULT_CHURCH_TIMEZONE);
    expect(getChurchTimeZone()).toBe(DEFAULT_CHURCH_TIMEZONE);

    expect(setChurchTimeZone(null)).toBe(DEFAULT_CHURCH_TIMEZONE);
    expect(getChurchTimeZone()).toBe(DEFAULT_CHURCH_TIMEZONE);
  });

  it('initializes the cache from the development database setting', async () => {
    const existing = await db('settings')
      .where({ key: SETTING_KEY })
      .first() as { id: number } | undefined;

    if (existing) {
      await db('settings')
        .where({ key: SETTING_KEY })
        .update({
          value: 'America/Edmonton',
          updated_at: db.fn.now(),
        });
    } else {
      await db('settings')
        .insert({
          key: SETTING_KEY,
          value: 'America/Edmonton',
          label: 'Church Timezone',
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
    }

    setChurchTimeZone(null);

    await initializeChurchTimeZoneCache();

    expect(getChurchTimeZone()).toBe('America/Edmonton');
  });

  it('falls back to the default timezone for an invalid database setting', async () => {
    const originalValue = originalSetting?.value ?? null;

    try {
      await db('settings')
        .where({ key: SETTING_KEY })
        .update({
          value: 'Invalid/Timezone',
          updated_at: db.fn.now(),
        });

      await initializeChurchTimeZoneCache();
      expect(getChurchTimeZone()).toBe(DEFAULT_CHURCH_TIMEZONE);
    } finally {
      await db('settings')
        .where({ key: SETTING_KEY })
        .update({
          value: originalValue,
          updated_at: db.fn.now(),
        });
    }
  });
});
