import { describe, expect, it, vi } from 'vitest';

import {
  acquireHardCloseLock,
  assertNotClosedPeriod,
  HARD_CLOSE_LOCK_KEY,
} from './hardCloseGuard.js';

describe('hardCloseGuard', () => {
  it('acquires advisory transaction lock', async () => {
    const raw = vi.fn().mockResolvedValue(undefined);
    const trx = Object.assign(vi.fn(), { raw }) as any;

    await acquireHardCloseLock(trx);

    expect(raw).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(?)',
      [HARD_CLOSE_LOCK_KEY.toString()],
    );
  });

  it('throws 422 when date falls within hard-closed period', async () => {
    const raw = vi.fn().mockResolvedValue(undefined);
    const first = vi.fn().mockResolvedValue({
      period_end: '2026-03-31',
      fiscal_year: 2026,
    });
    const select = vi.fn().mockReturnValue({ first });
    const orderBy = vi.fn().mockReturnValue({ select });
    const trx = Object.assign(vi.fn((table: string) => {
      if (table === 'fiscal_periods') return { orderBy };
      throw new Error(`Unexpected table: ${table}`);
    }), { raw }) as any;

    await expect(assertNotClosedPeriod('2026-03-31', trx)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('hard-closed period'),
    });
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('passes when no hard-close period applies', async () => {
    const raw = vi.fn().mockResolvedValue(undefined);
    const first = vi.fn().mockResolvedValue({
      period_end: '2026-03-31',
      fiscal_year: 2026,
    });
    const select = vi.fn().mockReturnValue({ first });
    const orderBy = vi.fn().mockReturnValue({ select });
    const trx = Object.assign(vi.fn((table: string) => {
      if (table === 'fiscal_periods') return { orderBy };
      throw new Error(`Unexpected table: ${table}`);
    }), { raw }) as any;

    await expect(assertNotClosedPeriod('2026-04-01', trx)).resolves.toBeUndefined();
    expect(raw).toHaveBeenCalledTimes(1);
  });
});
