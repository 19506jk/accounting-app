import type { BillSummary } from '@shared/contracts';

export type BillDisplayStatus = 'UNPAID' | 'PAID' | 'VOID' | 'PARTIAL';
type BillAmountFields = Pick<BillSummary, 'amount' | 'amount_paid'>;

export const fmt = (n: number | string | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });

export function getBillOutstanding(bill: BillAmountFields) {
  return Number(bill.amount) - Number(bill.amount_paid);
}

export function isBillVoided(bill: BillSummary) {
  return bill.status === 'VOID' || bill.is_voided;
}

export function getBillDisplayStatus(bill: BillSummary): BillDisplayStatus {
  if (isBillVoided(bill)) return 'VOID';
  if (bill.status === 'UNPAID' && Number(bill.amount_paid) > 0) return 'PARTIAL';
  return bill.status;
}

export function getBillStatusBadgeVariant(status: BillDisplayStatus) {
  if (status === 'PAID') return 'success';
  if (status === 'VOID') return 'secondary';
  if (status === 'PARTIAL') return 'info';
  return 'warning';
}
