import { describe, expect, it } from 'vitest';
import { getCurrentFiscalYear, getFiscalYearFromDate, getFiscalYearRange } from '../fiscalYear';

describe('getFiscalYearFromDate', () => {
  it('uses the ending-year convention for a July start', () => {
    expect(getFiscalYearFromDate('2025-07-01', 7)).toBe(2026);
    expect(getFiscalYearFromDate('2026-06-30', 7)).toBe(2026);
    expect(getFiscalYearFromDate('2026-07-01', 7)).toBe(2027);
    expect(getFiscalYearFromDate('2027-06-30', 7)).toBe(2027);
    expect(getFiscalYearFromDate('2026-12-31', 7)).toBe(2027);
  });

  it('uses the calendar year for a January start', () => {
    expect(getFiscalYearFromDate('2026-01-01', 1)).toBe(2026);
    expect(getFiscalYearFromDate('2026-07-01', 1)).toBe(2026);
    expect(getFiscalYearFromDate('2026-12-31', 1)).toBe(2026);
  });

  it('handles a March start crossing a leap-year February', () => {
    expect(getFiscalYearFromDate('2023-02-28', 3)).toBe(2023);
    expect(getFiscalYearFromDate('2023-03-01', 3)).toBe(2024);
  });
});

describe('getFiscalYearRange', () => {
  it('resolves FY2027 with a July start to July 2026 through June 2027', () => {
    expect(getFiscalYearRange(2027, 7)).toEqual({ from: '2026-07-01', to: '2027-06-30' });
  });

  it('resolves FY2026 with a July start to July 2025 through June 2026', () => {
    expect(getFiscalYearRange(2026, 7)).toEqual({ from: '2025-07-01', to: '2026-06-30' });
  });

  it('resolves a January-start fiscal year to the calendar year', () => {
    expect(getFiscalYearRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('ends a March-start fiscal year on leap-year February 29', () => {
    expect(getFiscalYearRange(2024, 3)).toEqual({ from: '2023-03-01', to: '2024-02-29' });
  });
});

describe('getCurrentFiscalYear', () => {
  it('keeps the existing device-local behavior unchanged', () => {
    const now = new Date();
    const expected = getFiscalYearFromDate(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
      7,
    );
    expect(getCurrentFiscalYear(7)).toBe(expected);
  });
});
