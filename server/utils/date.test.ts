import { describe, expect, it } from 'vitest';

import {
  addDaysDateOnly,
  compareDateOnly,
  isValidDateOnly,
  normalizeDateOnly,
  parseDateOnlyStrict,
} from './date.js';

describe('date utilities', () => {
  it('strictly validates date-only strings', () => {
    expect(isValidDateOnly('2026-04-16')).toBe(true);
    expect(parseDateOnlyStrict('2026-02-30')).toBeNull();
    expect(isValidDateOnly('04/16/2026')).toBe(false);
  });

  it('adds days and compares date-only strings', () => {
    expect(addDaysDateOnly('2026-04-16', 5, 'America/Toronto')).toBe('2026-04-21');
    expect(compareDateOnly('2026-04-16', '2026-04-17')).toBe(-1);
    expect(compareDateOnly('2026-04-17', '2026-04-16')).toBe(1);
    expect(compareDateOnly('2026-04-16', '2026-04-16')).toBe(0);
  });

  it('normalizes Date and invalid values safely', () => {
    expect(normalizeDateOnly(new Date('2026-04-16T12:30:00.000Z'))).toBe('2026-04-16');
    expect(normalizeDateOnly('not a date')).toBe('');
  });
});
