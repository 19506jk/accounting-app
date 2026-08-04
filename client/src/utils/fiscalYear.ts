export function getCurrentFiscalYear(fiscalStartMonth: number): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (fiscalStartMonth === 1) return year;
  return month >= fiscalStartMonth ? year + 1 : year;
}

const pad = (n: number) => String(n).padStart(2, '0');

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Ending-year convention, matching the server's fiscalYear helpers and Budget:
// FY2026 with a July start is July 2025 through June 2026. A January start
// makes the fiscal year the calendar year.
export function getFiscalYearFromDate(dateStr: string, fiscalStartMonth: number): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  if (fiscalStartMonth === 1) return year;
  return month >= fiscalStartMonth ? year + 1 : year;
}

// Inclusive date range for the given fiscal year, e.g. FY2026 with a July
// start is { from: '2025-07-01', to: '2026-06-30' }.
export function getFiscalYearRange(
  fiscalYear: number,
  fiscalStartMonth: number,
): { from: string; to: string } {
  const startYear = fiscalStartMonth === 1 ? fiscalYear : fiscalYear - 1;
  const nextStartYear = fiscalStartMonth === 1 ? fiscalYear + 1 : fiscalYear;
  const from = `${startYear}-${pad(fiscalStartMonth)}-01`;
  const to = dayBefore(`${nextStartYear}-${pad(fiscalStartMonth)}-01`);
  return { from, to };
}
