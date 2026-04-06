import type { Knex } from 'knex';
import { DEFAULT_CHURCH_TIMEZONE, isValidTimeZone } from '../utils/date.js';

const db = require('../db') as Knex;

const SETTING_KEY = 'church_timezone';

let churchTimeZone = DEFAULT_CHURCH_TIMEZONE;

export function getChurchTimeZone() {
  return churchTimeZone;
}

export function setChurchTimeZone(value?: string | null) {
  churchTimeZone = isValidTimeZone(value) ? String(value) : DEFAULT_CHURCH_TIMEZONE;
  return churchTimeZone;
}

export async function initializeChurchTimeZoneCache() {
  try {
    const row = await db('settings')
      .where({ key: SETTING_KEY })
      .select('value')
      .first() as { value?: string | null } | undefined;

    setChurchTimeZone(row?.value || null);
  } catch (err) {
    console.error('Failed to initialize church timezone setting. Falling back to default.', err);
    setChurchTimeZone(null);
  }
}
