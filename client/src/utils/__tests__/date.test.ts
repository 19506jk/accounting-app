import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_CHURCH_TIMEZONE,
  addDaysDateOnly,
  compareDateOnly,
  currentMonthRange,
  currentYearRange,
  getChurchTimeZone,
  getChurchToday,
  isDateOnlyBefore,
  isValidTimeZone,
  lastMonthRange,
  parseDateOnlyStrict,
  setChurchTimeZone,
  toDateOnly,
} from '../date'

describe('date helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:30:00Z'))
    setChurchTimeZone(DEFAULT_CHURCH_TIMEZONE)
  })

  afterEach(() => {
    vi.useRealTimers()
    setChurchTimeZone(DEFAULT_CHURCH_TIMEZONE)
  })

  it('validates timezone values', () => {
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Bad/TimeZone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('parses date-only values strictly', () => {
    expect(parseDateOnlyStrict('2026-03-15')?.format('YYYY-MM-DD')).toBe('2026-03-15')
    expect(parseDateOnlyStrict('2026-13-15')).toBeNull()
    expect(parseDateOnlyStrict('20260315')).toBeNull()
  })

  it('normalizes to date-only when possible', () => {
    expect(toDateOnly('2026-03-15')).toBe('2026-03-15')
    expect(toDateOnly('2026-03-15T16:45:00Z')).toBe('2026-03-15')
    expect(toDateOnly('not-a-date')).toBe('')
  })

  it('returns church today in requested timezone', () => {
    expect(getChurchToday('UTC')).toBe('2026-03-15')
  })

  it('adds days to strict date-only values and leaves invalid inputs unchanged', () => {
    expect(addDaysDateOnly('2026-03-15', 2, 'UTC')).toBe('2026-03-17')
    expect(addDaysDateOnly('bad', 2, 'UTC')).toBe('bad')
  })

  it('compares date-only values and exposes before helper', () => {
    expect(compareDateOnly('2026-03-15', '2026-03-16')).toBe(-1)
    expect(compareDateOnly('2026-03-16', '2026-03-15')).toBe(1)
    expect(compareDateOnly('2026-03-15', '2026-03-15')).toBe(0)
    expect(compareDateOnly(null, null)).toBe(0)
    expect(isDateOnlyBefore('2026-03-14', '2026-03-15')).toBe(true)
    expect(isDateOnlyBefore('2026-03-15', '2026-03-15')).toBe(false)
  })

  it('builds month/year ranges in timezone', () => {
    expect(currentMonthRange('UTC')).toEqual({
      from: '2026-03-01',
      to: '2026-03-15',
    })
    expect(lastMonthRange('UTC')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
    expect(currentYearRange('UTC')).toEqual({
      from: '2026-01-01',
      to: '2026-03-15',
    })
  })

  it('round-trips church timezone and falls back to default for invalid values', () => {
    expect(setChurchTimeZone('UTC')).toBe('UTC')
    expect(getChurchTimeZone()).toBe('UTC')
    expect(setChurchTimeZone('Not/AZone')).toBe(DEFAULT_CHURCH_TIMEZONE)
    expect(getChurchTimeZone()).toBe(DEFAULT_CHURCH_TIMEZONE)
  })
})
