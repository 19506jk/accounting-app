export function getCurrentFiscalYear(fiscalStartMonth: number): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (fiscalStartMonth === 1) return year;
  return month >= fiscalStartMonth ? year + 1 : year;
}
