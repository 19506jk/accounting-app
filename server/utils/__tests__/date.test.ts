import { describe, expect, it } from 'vitest';

import {
  addDaysDateOnly,
  compareDateOnly,
  getChurchToday,
  isValidTimeZone,
  isValidDateOnly,
  normalizeDateOnly,
  parseDateOnlyStrict,
  toUtcIsoString,
} from '../date.js';

describe('date utilities', () => {
  it('strictly validates date-only strings', () => {
    expect(isValidDateOnly('2026-04-16')).toBe(true);
    expect(parseDateOnlyStrict('2026-02-30')).toBeNull();
    expect(parseDateOnlyStrict('2024-02-29')?.format('YYYY-MM-DD')).toBe('2024-02-29');
    expect(parseDateOnlyStrict('2025-02-29')).toBeNull();
    expect(isValidDateOnly('04/16/2026')).toBe(false);
    expect(isValidDateOnly('2026-4-16')).toBe(false);
    expect(isValidDateOnly(null)).toBe(false);
  });

  it('adds days and compares date-only strings', () => {
    expect(addDaysDateOnly('2026-04-16', 5, 'America/Toronto')).toBe('2026-04-21');
    expect(addDaysDateOnly('2026-03-08', 1, 'America/Toronto')).toBe('2026-03-09');
    expect(addDaysDateOnly('not-a-date', 5, 'America/Toronto')).toBe('not-a-date');
    expect(compareDateOnly('2026-04-16', '2026-04-17')).toBe(-1);
    expect(compareDateOnly('2026-04-17', '2026-04-16')).toBe(1);
    expect(compareDateOnly('2026-04-16', '2026-04-16')).toBe(0);
    expect(compareDateOnly(null, null)).toBe(0);
    expect(compareDateOnly(null, '2026-04-16')).toBe(-1);
    expect(compareDateOnly('2026-04-16', null)).toBe(1);
  });

  it('normalizes Date and invalid values safely', () => {
    expect(normalizeDateOnly(new Date('2026-04-16T12:30:00.000Z'))).toBe('2026-04-16');
    expect(normalizeDateOnly('2026-04-16')).toBe('2026-04-16');
    expect(normalizeDateOnly(null)).toBe('');
    expect(normalizeDateOnly('not a date')).toBe('');
  });

  it('validates time zones and formats dates with fallbacks', () => {
    expect(isValidTimeZone('America/Toronto')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(getChurchToday('Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toUtcIsoString('not a date')).toBe('not a date');
    expect(toUtcIsoString('2026-04-16T12:30:00.000Z')).toBe('2026-04-16T12:30:00.000Z');
  });
});
