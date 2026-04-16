import { useEffect, useMemo, useState } from 'react';
import { useAccounts } from '../../api/useAccounts';
import { useApplyBillCredits, useAvailableBillCredits, useBill, usePayBill } from '../../api/useBills';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Combobox from '../../components/ui/Combobox';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatDateOnlyForDisplay, getChurchToday } from '../../utils/date';
import { getErrorMessage } from '../../utils/errors';
import { fmt, getBillOutstanding } from './billHelpers';
import type { BillDetail, BillSummary } from '@shared/contracts';
import type { OptionValue } from '../../components/ui/types';

interface PaymentState {
  payment_date: string;
  amount: number | '';
  bank_account_id: OptionValue | '';
  reference_no: string;
  memo: string;
}

interface PaymentModalProps {
  bill: BillSummary | BillDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onPaid?: () => void;
}

function toCents(value: number | string | null | undefined) {
  return Math.round((Number(value) || 0) * 100);
}

function fromCents(cents: number) {
  return cents / 100;
}

export default function PaymentModal({ bill, isOpen, onClose, onPaid }: PaymentModalProps) {
  const { addToast } = useToast();
  const payBill = usePayBill();
  const applyCredits = useApplyBillCredits();
  const { data: accounts } = useAccounts();
  const billId = isOpen ? bill?.id : null;
  const { data: billDetail, refetch: refetchBillDetail } = useBill(billId);
  const { data: creditData, isLoading: isLoadingCredits } = useAvailableBillCredits(billId);

  const activeBill = billDetail || bill;
  const outstanding = activeBill ? getBillOutstanding(activeBill) : 0;
  const payableOutstanding = Math.max(outstanding, 0);
  const payableOutstandingCents = toCents(payableOutstanding);
  const outstandingColor = outstanding > 0 ? '#dc2626' : outstanding < 0 ? '#1d4ed8' : '#15803d';
  const credits = creditData?.credits || [];

  const [payment, setPayment] = useState<PaymentState>({
    payment_date: getChurchToday(),
    amount: 0,
    bank_account_id: '',
    reference_no: '',
    memo: '',
  });
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [hasAppliedCredits, setHasAppliedCredits] = useState(false);
  const [lastApplyTransactionId, setLastApplyTransactionId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setAmounts({});
      setHasAppliedCredits(false);
      setLastApplyTransactionId(null);
      return;
    }
    setAmounts((prev) => {
      const next: Record<number, string> = {};
      credits.forEach((credit) => {
        next[credit.bill_id] = prev[credit.bill_id] ?? '';
      });
      return next;
    });
  }, [credits, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setPayment((prev) => ({
      ...prev,
      payment_date: prev.payment_date || getChurchToday(),
      amount: payableOutstandingCents > 0 ? fromCents(payableOutstandingCents) : 0,
    }));
  }, [isOpen, payableOutstandingCents]);

  const lines = useMemo(() => {
    return credits.map((credit) => {
      const parsed = Number(amounts[credit.bill_id] ?? '');
      const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      const requestedCents = toCents(requested);
      const availableCents = toCents(credit.available_amount);
      const cappedCents = Math.min(requestedCents, availableCents);
      return {
        ...credit,
        requestedCents: cappedCents,
        remainingCreditCents: Math.max(0, availableCents - cappedCents),
      };
    });
  }, [amounts, credits]);

  const totalAppliedCents = lines.reduce((sum, line) => sum + line.requestedCents, 0);
  const remainingBillCents = Math.max(0, payableOutstandingCents - totalAppliedCents);
  const totalApplied = fromCents(totalAppliedCents);
  const remainingBill = fromCents(remainingBillCents);
  const settledByCredits = outstanding <= 0;

  const bankAccountOptions = useMemo(
    () => (accounts || [])
      .filter((account) => account.type === 'ASSET' && account.is_active)
      .map((account) => ({ value: account.id, label: `${account.code} — ${account.name}` })),
    [accounts]
  );

  function setAmount(id: number, value: string) {
    setAmounts((prev) => ({ ...prev, [id]: value }));
  }

  function handleApplyMaximumNeeded() {
    let remainingCents = payableOutstandingCents;
    const next: Record<number, string> = {};

    credits.forEach((credit) => {
      if (remainingCents <= 0) {
        next[credit.bill_id] = '';
        return;
      }
      const availableCents = toCents(credit.available_amount);
      const takeCents = Math.min(remainingCents, availableCents);
      next[credit.bill_id] = takeCents > 0 ? String(fromCents(takeCents).toFixed(2)) : '';
      remainingCents = Math.max(0, remainingCents - takeCents);
    });

    setAmounts(next);
  }

  async function handleApplyCredits() {
    if (!activeBill) return;
    if (totalAppliedCents <= 0) {
      addToast('Enter at least one credit amount to apply.', 'error');
      return;
    }
    if (totalAppliedCents > payableOutstandingCents) {
      addToast('Total credit exceeds bill outstanding balance.', 'error');
      return;
    }

    const applications = lines
      .filter((line) => line.requestedCents > 0)
      .map((line) => ({
        credit_bill_id: line.bill_id,
        amount: fromCents(line.requestedCents),
      }));

    try {
      const result = await applyCredits.mutateAsync({ id: activeBill.id, applications });
      setHasAppliedCredits(true);
      setLastApplyTransactionId(result.transaction?.id ?? null);
      setAmounts({});
      await refetchBillDetail();
      onPaid?.();
      addToast('Credits applied successfully. This has been posted to the ledger.', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to apply credits.'), 'error');
    }
  }

  async function handlePay() {
    if (!activeBill) return;

    const refreshed = await refetchBillDetail();
    const latestBill = refreshed.data || activeBill;
    const latestOutstanding = getBillOutstanding(latestBill);
    const roundedLatestOutstanding = Math.round(Math.max(latestOutstanding, 0) * 100) / 100;

    if (roundedLatestOutstanding <= 0) {
      addToast('This bill has no payable balance.', 'error');
      return;
    }

    if (!payment.bank_account_id) {
      addToast('Please select a bank account.', 'error');
      return;
    }

    const paymentAmount = Math.round((Number(payment.amount) || 0) * 100) / 100;
    if (paymentAmount <= 0) {
      addToast('Please enter a payment amount.', 'error');
      return;
    }

    if (paymentAmount > roundedLatestOutstanding + 0.009) {
      addToast(`Payment cannot exceed the outstanding balance (${fmt(roundedLatestOutstanding)}).`, 'error');
      return;
    }

    const bankAccountId = Number(payment.bank_account_id);
    if (!Number.isFinite(bankAccountId)) {
      addToast('Please select a bank account.', 'error');
      return;
    }

    try {
      const payload = {
        id: latestBill.id,
        payment_date: payment.payment_date,
        amount: paymentAmount,
        bank_account_id: bankAccountId,
        reference_no: payment.reference_no,
        memo: payment.memo,
      };
      const result = await payBill.mutateAsync(payload);
      const isFullyPaid = result?.status === 'PAID';
      addToast(isFullyPaid ? 'Bill paid in full.' : 'Partial payment recorded.', 'success');
      onPaid?.();
      onClose();
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to pay bill.');
      addToast(msg, 'error');
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pay Bill" width="860px">
      {activeBill && (
        <>
          <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', margin: '-1.5rem -1.5rem 1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#6b7280', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '0.75rem' }}>
              <div><strong>Vendor:</strong> {activeBill.vendor_name}</div>
              <div><strong>Bill #:</strong> {activeBill.bill_number || '—'}</div>
              <div><strong>Amount:</strong> {fmt(activeBill.amount)}</div>
              <div><strong>Paid to Date:</strong> {fmt(activeBill.amount_paid)}</div>
              <div><strong>Outstanding:</strong> <span style={{ color: outstandingColor, fontWeight: 600 }}>{fmt(outstanding)}</span></div>
            </div>
          </div>

          <div style={{ marginBottom: '1rem', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0.9rem', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>Available Credits (FIFO)</div>
              <Button variant="secondary" size="sm" onClick={handleApplyMaximumNeeded} disabled={credits.length === 0 || payableOutstandingCents <= 0}>
                Apply Maximum Needed
              </Button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.7rem', color: '#64748b' }}>Credit Bill</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0.7rem', color: '#64748b' }}>Available</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0.7rem', color: '#64748b' }}>Apply</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0.7rem', color: '#64748b' }}>Remaining Credit</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingCredits && (
                  <tr>
                    <td colSpan={4} style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>Loading credits...</td>
                  </tr>
                )}
                {!isLoadingCredits && lines.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>No available vendor credits for this bill.</td>
                  </tr>
                )}
                {!isLoadingCredits && lines.map((line) => (
                  <tr key={line.bill_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.6rem 0.7rem' }}>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{line.bill_number || `#${line.bill_id}`}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{formatDateOnlyForDisplay(line.date)} · {line.description || 'Credit'}</div>
                    </td>
                    <td style={{ padding: '0.6rem 0.7rem', textAlign: 'right', color: '#1d4ed8', fontWeight: 600 }}>{fmt(line.available_amount)}</td>
                    <td style={{ padding: '0.6rem 0.7rem', width: '160px' }}>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amounts[line.bill_id] || ''}
                        onChange={(event) => setAmount(line.bill_id, event.target.value)}
                        disabled={payableOutstandingCents <= 0}
                        placeholder="0.00"
                        style={{ margin: 0 }}
                      />
                    </td>
                    <td style={{ padding: '0.6rem 0.7rem', textAlign: 'right', color: '#334155', fontWeight: 500 }}>{fmt(fromCents(line.remainingCreditCents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: '1rem', padding: '0.9rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Total Applied</div>
              <div style={{ fontWeight: 700, color: '#1e293b' }}>{fmt(totalApplied)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Remaining Bill Balance</div>
              <div style={{ fontWeight: 700, color: remainingBill > 0 ? '#b91c1c' : '#15803d' }}>{fmt(remainingBill)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
              <Button onClick={handleApplyCredits} isLoading={applyCredits.isPending} disabled={isLoadingCredits || lines.length === 0 || totalAppliedCents <= 0 || payableOutstandingCents <= 0}>
                Apply Credits
              </Button>
            </div>
          </div>

          {(hasAppliedCredits || lastApplyTransactionId) && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem 0.9rem', border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.85rem', color: '#166534' }}>
                Credits Applied. This posting is already recorded in the ledger.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Badge label="Credits Applied" variant="success" />
                {lastApplyTransactionId && (
                  <span style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 600 }}>
                    Tx #{lastApplyTransactionId}
                  </span>
                )}
              </div>
            </div>
          )}

          {settledByCredits ? (
            <div style={{ marginBottom: '1rem', padding: '1rem', borderRadius: '8px', border: '1px solid #bbf7d0', background: '#f0fdf4' }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#166534', marginBottom: '0.35rem' }}>
                Bill Settled
              </div>
              <div style={{ fontSize: '0.85rem', color: '#166534' }}>
                Outstanding balance is {fmt(outstanding)}. No cash payment is required.
                {lastApplyTransactionId ? ` Application transaction: #${lastApplyTransactionId}.` : ''}
              </div>
            </div>
          ) : (
            <>
              <Input
                label="Payment Date"
                required
                type="date"
                value={payment.payment_date}
                onChange={(event) => setPayment((prev) => ({ ...prev, payment_date: event.target.value }))}
                style={{ marginBottom: '1rem' }}
              />

              <Input
                label="Payment Amount"
                required
                type="number"
                min="0.01"
                step="0.01"
                value={payment.amount}
                onChange={(event) => {
                  const value = event.target.value;
                  setPayment((prev) => ({ ...prev, amount: value === '' ? '' : parseFloat(value) || 0 }));
                }}
                style={{ marginBottom: '1rem' }}
              />

              <Combobox
                label="Bank Account"
                required
                options={bankAccountOptions}
                value={payment.bank_account_id}
                onChange={(value) => setPayment((prev) => ({ ...prev, bank_account_id: value }))}
                placeholder="Select bank account..."
                style={{ marginBottom: '1rem' }}
              />

              <Input
                label="Reference No"
                value={payment.reference_no}
                onChange={(event) => setPayment((prev) => ({ ...prev, reference_no: event.target.value }))}
                placeholder="e.g., Cheque #123"
                style={{ marginBottom: '1rem' }}
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}>Memo</label>
                <textarea
                  value={payment.memo}
                  onChange={(event) => setPayment((prev) => ({ ...prev, memo: event.target.value }))}
                  rows={2}
                  style={{ padding: '0.45rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: '0.5rem' }}>
                  Payment Journal Entry
                </div>
                <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
                  <div style={{ color: '#15803d' }}>
                    Dr Accounts Payable (20000) — {fmt(payment.amount || 0)}
                  </div>
                  <div style={{ color: '#b91c1c' }}>
                    Cr {bankAccountOptions.find((account) => account.value === payment.bank_account_id)?.label || 'Bank Account'} — {fmt(payment.amount || 0)}
                  </div>
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <Button variant="secondary" onClick={onClose}>{settledByCredits ? 'Close' : 'Cancel'}</Button>
            {!settledByCredits && (
              <Button onClick={handlePay} isLoading={payBill.isPending} disabled={outstanding <= 0}>
                Pay Bill
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
