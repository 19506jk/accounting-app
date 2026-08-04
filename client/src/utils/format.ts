/**
 * Format a number as en-CA dollars, dashboard style: the sign follows the
 * currency symbol ($-2,500.00, never -$2,500.00). Non-numbers render as '—'.
 */
export function formatMoney(n: number | null | undefined): string {
  return typeof n === 'number'
    ? '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2 })
    : '—';
}
