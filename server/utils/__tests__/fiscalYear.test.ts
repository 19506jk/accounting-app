import { describe, expect, it } from 'vitest';

import { dayAfter, dayBefore, getFiscalYearDateRange, getFiscalYearStartDate } from '../fiscalYear.js';

describe('dayBefore / dayAfter', () => {
  it('steps backward and forward correctly', () => {
    expect(dayBefore('2026-01-01')).toBe('2025-12-31');
    expect(dayBefore('2024-03-01')).toBe('2024-02-29'); // leap year
    expect(dayAfter('2025-12-31')).toBe('2026-01-01');
    expect(dayAfter('2024-02-28')).toBe('2024-02-29'); // leap year
  });
});

describe('getFiscalYearStartDate', () => {
  it('returns the start of the fiscal year containing the given date (January start)', () => {
    expect(getFiscalYearStartDate('2026-06-15', 1)).toBe('2026-01-01');
    expect(getFiscalYearStartDate('2026-01-01', 1)).toBe('2026-01-01');
    expect(getFiscalYearStartDate('2026-12-31', 1)).toBe('2026-01-01');
  });

  it('returns the start of the fiscal year containing the given date (July start)', () => {
    // Aug 2026 is inside FY that started July 2026
    expect(getFiscalYearStartDate('2026-08-15', 7)).toBe('2026-07-01');
    // March 2026 is inside FY that started July 2025
    expect(getFiscalYearStartDate('2026-03-15', 7)).toBe('2025-07-01');
    // Exactly on start month
    expect(getFiscalYearStartDate('2026-07-01', 7)).toBe('2026-07-01');
    expect(getFiscalYearStartDate('2026-06-30', 7)).toBe('2025-07-01');
  });
});

describe('getFiscalYearDateRange', () => {
  it('returns full calendar year for January-start fiscal year', () => {
    const { period_start, period_end } = getFiscalYearDateRange(2026, 1);
    expect(period_start).toBe('2026-01-01');
    expect(period_end).toBe('2026-12-31');
  });

  it('spans two calendar years for mid-year start (July)', () => {
    // FY2026 with startMonth=7 → July 2025 to June 2026
    const { period_start, period_end } = getFiscalYearDateRange(2026, 7);
    expect(period_start).toBe('2025-07-01');
    expect(period_end).toBe('2026-06-30');
  });

  it('handles fiscal year ending in leap-year February correctly (March start)', () => {
    // FY2024 with startMonth=3 → March 2023 to Feb 2024 (leap year)
    const { period_start, period_end } = getFiscalYearDateRange(2024, 3);
    expect(period_start).toBe('2023-03-01');
    expect(period_end).toBe('2024-02-29');
  });

  it('prior year is always year-1 with same boundaries shifted back', () => {
    const fy2026 = getFiscalYearDateRange(2026, 7);
    const fy2025 = getFiscalYearDateRange(2025, 7);
    // FY2025 ends the day before FY2026 starts
    expect(dayAfter(fy2025.period_end)).toBe(fy2026.period_start);
  });
});
