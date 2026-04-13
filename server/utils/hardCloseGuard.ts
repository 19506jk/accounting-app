import type { Knex } from 'knex';
import { normalizeDateOnly } from './date.js';

export const HARD_CLOSE_LOCK_KEY = 7654321987n;

export async function acquireHardCloseLock(trx: Knex.Transaction): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(?)', [HARD_CLOSE_LOCK_KEY.toString()]);
}

export async function assertNotClosedPeriod(
  date: string,
  trx: Knex.Transaction,
): Promise<void> {
  await acquireHardCloseLock(trx);

  const lastClose = await trx('fiscal_periods')
    .orderBy('period_end', 'desc')
    .select('period_end', 'fiscal_year')
    .first() as { period_end: string | Date; fiscal_year: number } | undefined;

  const periodEnd = lastClose ? normalizeDateOnly(lastClose.period_end) : null;
  if (lastClose && periodEnd && date <= periodEnd) {
    const err = new Error(
      `Transaction date ${date} falls within a hard-closed period (FY${lastClose.fiscal_year}, through ${periodEnd}).`
    ) as Error & { status: number };
    err.status = 422;
    throw err;
  }
}
