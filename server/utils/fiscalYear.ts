import type { Knex } from 'knex';

type Executor = Knex | Knex.Transaction;

export function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function getFiscalYearStartDate(asOf: string, fiscalStartMonth: number): string {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const fiscalYear = month >= fiscalStartMonth ? year : year - 1;
  return `${fiscalYear}-${String(fiscalStartMonth).padStart(2, '0')}-01`;
}

export async function getFiscalStartMonth(executor: Executor): Promise<number> {
  const row = await executor('settings')
    .where({ key: 'fiscal_year_start' })
    .select('value')
    .first() as { value?: string | null } | undefined;
  return Math.max(1, Math.min(12, parseInt(row?.value ?? '1', 10) || 1));
}

// For fiscal year N, period_start and period_end driven by start month.
// FY2026 with startMonth=1 → 2026-01-01 to 2026-12-31
// FY2026 with startMonth=7 → 2025-07-01 to 2026-06-30
export function getFiscalYearDateRange(
  fiscalYear: number,
  fiscalStartMonth: number,
): { period_start: string; period_end: string } {
  const startYear = fiscalStartMonth === 1 ? fiscalYear : fiscalYear - 1;
  const nextStartYear = fiscalStartMonth === 1 ? fiscalYear + 1 : fiscalYear;
  const pad = (n: number) => String(n).padStart(2, '0');
  const period_start = `${startYear}-${pad(fiscalStartMonth)}-01`;
  const period_end = dayBefore(`${nextStartYear}-${pad(fiscalStartMonth)}-01`);
  return { period_start, period_end };
}
