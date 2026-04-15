// @ts-nocheck
import { useState, useMemo, useEffect } from 'react';
import { useBills, useBill, useCreateBill, useUpdateBill, usePayBill, useVoidBill, useAvailableBillCredits, useApplyBillCredits } from '../api/useBills';
import { useTaxRates } from '../api/useTaxRates';
import { useContacts } from '../api/useContacts';
import { useAccounts } from '../api/useAccounts';
import { useFunds } from '../api/useFunds';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Drawer from '../components/ui/Drawer';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Combobox from '../components/ui/Combobox';
import Badge from '../components/ui/Badge';
import DateRangePicker from '../components/ui/DateRangePicker';
import ExpenseBreakdown from '../components/ExpenseBreakdown';
import {
  currentMonthRange,
  formatDateOnlyForDisplay,
  getChurchToday,
  isDateOnlyBefore,
  toDateOnly,
} from '../utils/date';

const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
const MAX_ROUNDING = 0.10;
const ROUNDING_PATTERN = /^-?\d*(?:\.\d*)?$/;

function currentMonth() {
  return currentMonthRange();
}

function createEmptyLineItem(tempId) {
  return {
    id: tempId,
    expense_account_id: '',
    description: '',
    amount: '',
    tax_rate_id: '',
    rounding_adjustment: '',
  };
}

function createEmptyForm() {
  return {
    bill_type: 'BILL',
    contact_id: '',
    date: getChurchToday(),
    due_date: '',
    bill_number: '',
    description: '',
    fund_id: '',
    line_items: [createEmptyLineItem('temp-1')],
  };
}

let tempIdCounter = 1;
const billTypeOptions = [
  { value: 'BILL', label: 'Bill' },
  { value: 'CREDIT', label: 'Credit' },
];

function normalizeLineAmount(value, billType) {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  const absolute = Math.abs(parsed);
  return billType === 'CREDIT' ? absolute * -1 : absolute;
}

function parseRoundingAdjustment(value) {
  if (value === '' || value === '-' || value === '.') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function coerceDateOnly(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const directDateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directDateOnly?.[1]) return directDateOnly[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return toDateOnly(raw);
}

function BillForm({ bill, onClose, onSaved, onVoid, canVoid = false, isVoiding = false, readOnly = false }) {
  const { addToast } = useToast();
  const { data: contacts } = useContacts({ type: 'PAYEE' });
  const { data: accounts } = useAccounts();
  const { data: funds } = useFunds();
  const { data: taxRates = [] } = useTaxRates({ activeOnly: true });
  const createBill = useCreateBill();
  const updateBill = useUpdateBill();

  const [form, setForm] = useState(bill ? {
    bill_type: parseFloat(bill.amount) < 0 ? 'CREDIT' : 'BILL',
    contact_id: String(bill.contact_id),
    date: coerceDateOnly(bill.date),
    due_date: coerceDateOnly(bill.due_date),
    bill_number: bill.bill_number || '',
    description: bill.description || '',
    fund_id: String(bill.fund_id),
    line_items: bill.line_items?.map((li) => ({
      id: `existing-${li.id}`,
      expense_account_id: String(li.expense_account_id),
      description: li.description || '',
      amount: Math.abs(parseFloat(li.amount || 0)) || '',
      tax_rate_id: li.tax_rate_id ? String(li.tax_rate_id) : '',
      rounding_adjustment: li.rounding_adjustment != null ? String(li.rounding_adjustment) : '',
    })) || [createEmptyLineItem('temp-1')],
  } : createEmptyForm());

  useEffect(() => {
    if (!bill && funds && funds.length > 0 && !form.fund_id) {
      const firstActiveFund = funds.find(f => f.is_active);
      if (firstActiveFund) {
        setForm(f => ({ ...f, fund_id: String(firstActiveFund.id) }));
      }
    }
  }, [funds, bill, form.fund_id]);

  const [errors, setErrors] = useState({});

  const vendorOptions = (contacts || [])
    .filter(c => ['PAYEE', 'BOTH'].includes(c.type))
    .map(c => ({ value: String(c.id), label: c.name }));

  const expenseAccountOptions = (accounts || [])
    .filter(a => a.type === 'EXPENSE' && a.is_active)
    .map(a => ({ value: String(a.id), label: `${a.code} — ${a.name}` }));

  const fundOptions = (funds || [])
    .filter(f => f.is_active)
    .map(f => ({ value: String(f.id), label: f.name }));

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const taxRateOptions = [
    { value: '', label: 'Exempt' },
    ...taxRates.map(tr => ({ value: String(tr.id), label: `${tr.name} (${(tr.rate * 100).toFixed(2)}%)` })),
  ];

  // Build a lookup map for quick rate access in calculations
  const taxRateMap = useMemo(() => {
    return Object.fromEntries(taxRates.map(tr => [String(tr.id), tr]));
  }, [taxRates]);

  // Per-line tax breakdown using the internal tax formula: gross = net * (1 + rate)
  const lineTotals = useMemo(() => {
    return form.line_items.map(li => {
      const net = normalizeLineAmount(li.amount, form.bill_type);
      const rounding = parseRoundingAdjustment(li.rounding_adjustment);
      const taxRate = li.tax_rate_id ? taxRateMap[li.tax_rate_id] : null;
      if (!taxRate || net === 0) {
        return { gross: Math.round((net + rounding) * 100) / 100, net, tax: 0, taxName: null, rounding };
      }
      const tax = Math.round(net * taxRate.rate * 100) / 100;
      const gross = Math.round((net + tax + rounding) * 100) / 100;
      return { gross, net, tax, taxName: taxRate.name, rounding };
    });
  }, [form.bill_type, form.line_items, taxRateMap]);

  const lineTotal   = useMemo(
    () => Math.round(lineTotals.reduce((sum, l) => sum + l.gross, 0) * 100) / 100, [lineTotals]
  );
  const totalHST    = useMemo(() => lineTotals.filter(l => l.taxName === 'HST').reduce((sum, l) => sum + l.tax, 0), [lineTotals]);
  const totalGST    = useMemo(() => lineTotals.filter(l => l.taxName === 'GST').reduce((sum, l) => sum + l.tax, 0), [lineTotals]);
  const totalTax    = totalHST + totalGST;
  const totalRounding = useMemo(() => lineTotals.reduce((sum, l) => sum + l.rounding, 0), [lineTotals]);
  const totalNet    = useMemo(() => lineTotals.reduce((sum, l) => sum + l.net, 0), [lineTotals]);
  const amountDelta = bill ? Math.abs(lineTotal - (parseFloat(bill.amount) || 0)) : 0;
  const willRecalculateAmount = Boolean(bill && amountDelta > 0.01);

  function addLineItem() {
    tempIdCounter++;
    setForm(f => ({
      ...f,
      line_items: [...f.line_items, createEmptyLineItem(`temp-${tempIdCounter}`)],
    }));
  }

  function removeLineItem(index) {
    if (form.line_items.length <= 1) return;
    setForm(f => ({
      ...f,
      line_items: f.line_items.filter((_, i) => i !== index),
    }));
  }

  function updateLineItem(index, field, value) {
    setForm(f => ({
      ...f,
      line_items: f.line_items.map((li, i) => 
        i === index ? { ...li, [field]: value } : li
      ),
    }));
  }

  function validate() {
    const errs = {};
    if (!form.contact_id) errs.contact_id = 'Vendor is required';
    if (!form.date) errs.date = 'Date is required';
    // due_date is optional - no validation needed
    // description is optional - no validation needed

    const lineItemErrors = [];
    let hasLineItemErrors = false;
    form.line_items.forEach((li, idx) => {
      const lineErr = {};
      if (!li.expense_account_id) {
        lineErr.expense_account_id = 'Required';
        hasLineItemErrors = true;
      }
      // line item description is optional - no validation needed
      if (!li.amount || parseFloat(li.amount) === 0) {
        lineErr.amount = 'Required';
        hasLineItemErrors = true;
      }
      const rawRounding = String(li.rounding_adjustment);
      const rounding = Number(rawRounding);
      if (rawRounding !== '' && (rawRounding === '-' || rawRounding === '.' || !ROUNDING_PATTERN.test(rawRounding) || !Number.isFinite(rounding))) {
        lineErr.rounding_adjustment = 'Invalid number';
        hasLineItemErrors = true;
      } else if (Number.isFinite(rounding)) {
        const parts = rawRounding.split('.');
        if (parts[1] && parts[1].length > 2) {
          lineErr.rounding_adjustment = 'Max 2 decimal places';
          hasLineItemErrors = true;
        } else if (Math.abs(rounding) > MAX_ROUNDING) {
          lineErr.rounding_adjustment = `Cannot exceed ${MAX_ROUNDING.toFixed(2)}`;
          hasLineItemErrors = true;
        }
      }
      if (lineErr && Object.keys(lineErr).length > 0) {
        lineItemErrors[idx] = lineErr;
      }
    });

    if (hasLineItemErrors) errs.line_items = lineItemErrors;

    if (form.date && form.due_date && form.due_date < form.date) {
      errs.due_date = 'Due date cannot be before bill date';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave(andPay = false) {
    if (readOnly) return;
    if (!validate()) return;

    try {
      const payload = {
        contact_id: parseInt(form.contact_id),
        date: form.date,
        due_date: form.due_date,
        bill_number: form.bill_number || null,
        description: form.description,
        amount: lineTotal,
        fund_id: parseInt(form.fund_id),
        line_items: form.line_items.map(li => ({
          expense_account_id: parseInt(li.expense_account_id),
          description: li.description.trim(),
          amount: normalizeLineAmount(li.amount, form.bill_type),
          rounding_adjustment: parseRoundingAdjustment(li.rounding_adjustment),
          tax_rate_id: li.tax_rate_id ? parseInt(li.tax_rate_id) : null,
        })),
      };

      if (bill) {
        try {
          await updateBill.mutateAsync({ id: bill.id, ...payload });
        } catch (innerErr) {
          const errMsg = innerErr.response?.data?.errors?.[0] || '';
          if (errMsg.includes('Confirm unapply')) {
            const confirmed = window.confirm(
              'This bill has applied credits. Updating it will unapply existing credits first. You will need to manually re-apply credits after saving. Continue?'
            );
            if (!confirmed) return;
            await updateBill.mutateAsync({ id: bill.id, ...payload, confirm_unapply_credits: true });
          } else {
            throw innerErr;
          }
        }
        addToast('Bill updated.', 'success');
      } else {
        await createBill.mutateAsync(payload);
        addToast('Bill created.', 'success');
      }

      if (andPay) {
        onSaved?.(true);
      } else {
        onSaved?.();
        onClose();
      }
    } catch (err) {
      const msg = err.response?.data?.errors?.[0] || 'Failed to save.';
      addToast(msg, 'error');
    }
  }

  const isSaving = createBill.isPending || updateBill.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <Combobox label="Vendor" required options={vendorOptions} value={form.contact_id}
            onChange={(v) => setForm((f) => ({ ...f, contact_id: v }))} placeholder="Select vendor…"
            error={errors.contact_id} disabled={readOnly} />
          <Input label="Bill Number" value={form.bill_number} onChange={set('bill_number')}
            placeholder="e.g., INV-001" disabled={readOnly} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <Input label="Bill Date" required type="date" value={form.date} onChange={set('date')}
            error={errors.date} disabled={readOnly} />
          <Input label="Due Date" type="date" value={form.due_date} onChange={set('due_date')}
            error={errors.due_date} disabled={readOnly} />
        </div>

        <Select label="Type" options={billTypeOptions} value={form.bill_type}
          onChange={set('bill_type')} style={{ marginBottom: '1rem' }} disabled={readOnly} />

        <Input label="Description" value={form.description} onChange={set('description')}
          placeholder="e.g., Office supplies" error={errors.description}
          style={{ marginBottom: '1rem' }} disabled={readOnly} />

        <Combobox label="Fund" required options={fundOptions} value={form.fund_id}
          onChange={(v) => setForm((f) => ({ ...f, fund_id: v }))} placeholder="Select fund…"
          error={errors.fund_id} style={{ marginBottom: '1.5rem' }} disabled={readOnly} />

        <div style={{ marginBottom: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '0.5rem' }}>
            {form.bill_type === 'CREDIT' ? 'Credit Lines' : 'Expense Lines'}
          </label>
        </div>

        <ExpenseBreakdown
          lines={form.line_items}
          lineTotals={lineTotals}
          expenseAccountOptions={expenseAccountOptions}
          taxRateOptions={taxRateOptions}
          onChange={updateLineItem}
          onRemove={removeLineItem}
          errors={errors.line_items}
          readOnly={readOnly}
          showGrossColumn={false}
          minWidth={700}
        />

        {!readOnly && (
          <Button variant="secondary" size="sm" onClick={addLineItem} style={{ marginBottom: '1.5rem' }}>
            + Add Line
          </Button>
        )}

        <div style={{ 
          padding: '0.75rem 1rem', 
          background: '#f9fafb', 
          borderRadius: '8px',
          marginBottom: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '0.3rem',
          fontSize: '0.85rem',
        }}>
          {willRecalculateAmount && (
            <div style={{ color: '#92400e', fontWeight: 600 }}>
              Saving this bill will update stored amount from {fmt(bill.amount)} to {fmt(lineTotal)}.
            </div>
          )}
          {totalTax !== 0 && (
            <>
              <div style={{ color: '#6b7280' }}>
                Subtotal (net): <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totalNet)}</span>
              </div>
              {totalHST !== 0 && (
                <div style={{ color: '#6b7280' }}>
                  HST: <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totalHST)}</span>
                </div>
              )}
              {totalGST !== 0 && (
                <div style={{ color: '#6b7280' }}>
                  GST: <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totalGST)}</span>
                </div>
              )}
              {totalRounding !== 0 && (
                <div style={{ color: '#6b7280' }}>
                  Rounding: <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totalRounding)}</span>
                </div>
              )}
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.3rem', marginTop: '0.1rem' }}>
                Grand Total: <span style={{ fontWeight: 700, color: '#1e293b', marginLeft: '1rem' }}>{fmt(lineTotal)}</span>
              </div>
            </>
          )}
          {totalTax === 0 && (
            <>
              {totalRounding !== 0 && (
                <div style={{ color: '#6b7280' }}>
                  Rounding: <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totalRounding)}</span>
                </div>
              )}
              <span style={{ fontWeight: 600, color: '#1e293b' }}>Total: {fmt(lineTotal)}</span>
            </>
          )}
        </div>

        {form.line_items.length > 0 && form.fund_id && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: '0.5rem' }}>
              Journal Entry Preview
            </div>
            <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
              {form.line_items.map((li, idx) => {
                const account = expenseAccountOptions.find(a => a.value === li.expense_account_id);
                const { gross, net, tax, taxName, rounding = 0 } = lineTotals[idx] || {};
                if (!gross || gross === 0) return null;
                const taxRate = li.tax_rate_id ? taxRateMap[li.tax_rate_id] : null;

                return (
                  <div key={idx}>
                    <div style={{ color: net >= 0 ? '#15803d' : '#b91c1c' }}>
                      {net >= 0 ? 'Dr' : 'Cr'} {account?.label || 'Expense'} — {fmt(Math.abs(net))}
                    </div>
                    {tax !== 0 && taxRate && (
                      <div style={{ color: tax >= 0 ? '#15803d' : '#b91c1c', paddingLeft: '1rem', fontSize: '0.8rem' }}>
                        {tax >= 0 ? 'Dr' : 'Cr'} {taxRate.recoverable_account_name || `${taxName} Recoverable`} — {fmt(Math.abs(tax))}
                      </div>
                    )}
                    {rounding !== 0 && (
                      <div style={{ color: rounding > 0 ? '#15803d' : '#b91c1c', paddingLeft: '1rem', fontSize: '0.8rem' }}>
                        {rounding > 0 ? 'Dr' : 'Cr'} Rounding (59999) — {fmt(Math.abs(rounding))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ color: lineTotal >= 0 ? '#b91c1c' : '#15803d', marginTop: '0.25rem', fontWeight: 500 }}>
                {lineTotal >= 0 ? 'Cr' : 'Dr'} Accounts Payable (20000) — {fmt(Math.abs(lineTotal))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div>
          {bill && !readOnly && canVoid && bill.status === 'UNPAID' && !bill.is_voided && (
            <Button
              variant="ghost"
              onClick={() => onVoid?.(bill)}
              isLoading={isVoiding}
              style={{ color: '#dc2626' }}
            >
              Void Bill
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Button variant="secondary" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && !bill && (
            <Button variant="secondary" onClick={() => handleSave(true)} isLoading={isSaving}>
              Save & Pay
            </Button>
          )}
          {!readOnly && (
            <Button onClick={() => handleSave(false)} isLoading={isSaving}>
              {bill ? 'Update' : 'Save'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PaymentModal({ bill, isOpen, onClose, onPaid }) {
  const toCents = (value) => Math.round((Number(value) || 0) * 100);
  const fromCents = (cents) => cents / 100;

  const { addToast } = useToast();
  const payBill = usePayBill();
  const applyCredits = useApplyBillCredits();
  const { data: accounts } = useAccounts();
  const billId = isOpen ? bill?.id : null;
  const { data: billDetail, refetch: refetchBillDetail } = useBill(billId);
  const { data: creditData, isLoading: isLoadingCredits } = useAvailableBillCredits(billId);

  const activeBill = billDetail || bill;
  const outstanding = activeBill ? parseFloat(activeBill.amount) - parseFloat(activeBill.amount_paid) : 0;
  const payableOutstanding = Math.max(outstanding, 0);
  const payableOutstandingCents = toCents(payableOutstanding);
  const outstandingColor = outstanding > 0 ? '#dc2626' : outstanding < 0 ? '#1d4ed8' : '#15803d';
  const credits = creditData?.credits || [];

  const [payment, setPayment] = useState({
    payment_date: getChurchToday(),
    amount: 0,
    bank_account_id: '',
    reference_no: '',
    memo: '',
  });
  const [amounts, setAmounts] = useState({});
  const [hasAppliedCredits, setHasAppliedCredits] = useState(false);
  const [lastApplyTransactionId, setLastApplyTransactionId] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      setAmounts({});
      setHasAppliedCredits(false);
      setLastApplyTransactionId(null);
      return;
    }
    setAmounts((prev) => {
      const next = {};
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
      const parsed = parseFloat(amounts[credit.bill_id]);
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

  const bankAccountOptions = (accounts || [])
    .filter(a => a.type === 'ASSET' && a.is_active)
    .map(a => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  function setAmount(id, value) {
    setAmounts((prev) => ({ ...prev, [id]: value }));
  }

  function handleApplyMaximumNeeded() {
    let remainingCents = payableOutstandingCents;
    const next = {};

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
      addToast(err.response?.data?.errors?.[0] || 'Failed to apply credits.', 'error');
    }
  }

  async function handlePay() {
    if (!activeBill) return;

    const refreshed = await refetchBillDetail();
    const latestBill = refreshed.data || activeBill;
    const latestOutstanding = parseFloat(latestBill.amount) - parseFloat(latestBill.amount_paid);
    const roundedLatestOutstanding = Math.round(Math.max(latestOutstanding, 0) * 100) / 100;

    if (roundedLatestOutstanding <= 0) {
      addToast('This bill has no payable balance.', 'error');
      return;
    }

    if (!payment.bank_account_id) {
      addToast('Please select a bank account.', 'error');
      return;
    }

    const paymentAmount = Math.round((parseFloat(payment.amount) || 0) * 100) / 100;
    if (paymentAmount <= 0) {
      addToast('Please enter a payment amount.', 'error');
      return;
    }

    if (paymentAmount > roundedLatestOutstanding + 0.009) {
      addToast(`Payment cannot exceed the outstanding balance (${fmt(roundedLatestOutstanding)}).`, 'error');
      return;
    }

    try {
      const result = await payBill.mutateAsync({
        id: latestBill.id,
        payment_date: payment.payment_date,
        amount: paymentAmount,
        bank_account_id: payment.bank_account_id,
        reference_no: payment.reference_no,
        memo: payment.memo,
      });
      const isFullyPaid = result?.status === 'PAID';
      addToast(isFullyPaid ? 'Bill paid in full.' : 'Partial payment recorded.', 'success');
      onPaid?.();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.errors?.[0] || 'Failed to pay bill.';
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
                        onChange={(e) => setAmount(line.bill_id, e.target.value)}
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
                onChange={(e) => setPayment((p) => ({ ...p, payment_date: e.target.value }))}
                style={{ marginBottom: '1rem' }}
              />

              <Input
                label="Payment Amount"
                required
                type="number"
                min="0.01"
                step="0.01"
                value={payment.amount}
                onChange={(e) => {
                  const value = e.target.value;
                  setPayment((p) => ({ ...p, amount: value === '' ? '' : parseFloat(value) || 0 }));
                }}
                style={{ marginBottom: '1rem' }}
              />

              <Combobox
                label="Bank Account"
                required
                options={bankAccountOptions}
                value={payment.bank_account_id}
                onChange={(v) => setPayment((p) => ({ ...p, bank_account_id: v }))}
                placeholder="Select bank account..."
                style={{ marginBottom: '1rem' }}
              />

              <Input
                label="Reference No"
                value={payment.reference_no}
                onChange={(e) => setPayment((p) => ({ ...p, reference_no: e.target.value }))}
                placeholder="e.g., Cheque #123"
                style={{ marginBottom: '1rem' }}
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}>Memo</label>
                <textarea
                  value={payment.memo}
                  onChange={(e) => setPayment((p) => ({ ...p, memo: e.target.value }))}
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
                    Cr {bankAccountOptions.find(a => a.value === payment.bank_account_id)?.label || 'Bank Account'} — {fmt(payment.amount || 0)}
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

export default function Bills() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const [range, setRange] = useState(currentMonth());
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [paymentBill, setPaymentBill] = useState(null);

  const { data: bills, isLoading, refetch } = useBills({
    status: statusFilter || undefined,
    contact_id: vendorFilter || undefined,
    from: range.from,
    to: range.to,
    limit: 200,
  });

  const { data: contacts } = useContacts({ type: 'PAYEE' });
  const createBill = useCreateBill();
  const voidBill = useVoidBill();

  const vendorOptions = [
    { value: '', label: 'All Vendors' },
    ...(contacts || []).map(c => ({ value: c.id, label: c.name })),
  ];

  const statusOptions = [
    { value: '', label: 'All Statuses' },
    { value: 'UNPAID', label: 'Unpaid' },
    { value: 'PAID', label: 'Paid' },
    { value: 'VOID', label: 'Void' },
  ];

  const canEdit = ['admin', 'editor'].includes(user?.role);
  const canVoid = user?.role === 'admin';
  const isAddDrawer = drawer?.type === 'add';
  const isViewDrawer = drawer?.type === 'view';
  const activeBill = drawer?.bill || null;
  const getOutstanding = (b) => parseFloat(b.amount) - parseFloat(b.amount_paid);

  function handleAdd() {
    setDrawer({ type: 'add' });
  }

  function handleEdit(bill) {
    setDrawer({ type: 'edit', bill });
  }

  function handleView(bill) {
    setDrawer({ type: 'view', bill });
  }

  function handlePay(bill) {
    setPaymentBill(bill);
  }

  async function handleVoid(bill, { closeDrawer = false } = {}) {
    const confirmed = window.confirm(
      `Are you sure you want to void this bill? This action cannot be undone and will be recorded in the audit history.\n\n` +
      `Vendor: ${bill.vendor_name}\n` +
      `Amount: ${fmt(bill.amount)}\n` +
      `Bill #: ${bill.bill_number || '—'}`
    );
    
    if (!confirmed) return;

    try {
      await voidBill.mutateAsync(bill.id);
      addToast('Bill voided successfully.', 'success');
      if (closeDrawer) setDrawer(null);
      refetch();
    } catch (err) {
      addToast(err.response?.data?.errors?.[0] || 'Cannot void bill.', 'error');
    }
  }

  function handleRowClick(bill) {
    const isVoided = bill.status === 'VOID' || bill.is_voided;
    if (isVoided) return;
    if (bill.status === 'PAID') {
      handleView(bill);
      return;
    }
    if (bill.status === 'UNPAID') {
      handleEdit(bill);
    }
  }

  function handleDrawerSaved(andPay) {
    refetch();
    if (andPay && createBill.data) {
      setPaymentBill(createBill.data);
    }
  }

  const COLUMNS = [
    {
      key: 'date',
      label: 'Date',
      render: (b) => formatDateOnlyForDisplay(b.date),
    },
    {
      key: 'vendor_name',
      label: 'Vendor',
      render: (b) => (
        <div>
          <div style={{ fontWeight: 500, color: '#1e293b' }}>{b.vendor_name}</div>
          {b.bill_number && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>#{b.bill_number}</div>}
        </div>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      wrap: true,
      render: (b) => <div style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.description}</div>,
    },
    {
      key: 'due_date',
      label: 'Due Date',
      render: (b) => {
        if (!b.due_date) return <span style={{ color: '#6b7280' }}>—</span>;
        const isOverdue = b.status === 'UNPAID' && isDateOnlyBefore(b.due_date, getChurchToday());
        return (
          <span style={{ color: isOverdue ? '#dc2626' : 'inherit', fontWeight: isOverdue ? 600 : 400 }}>
            {formatDateOnlyForDisplay(b.due_date)}
          </span>
        );
      },
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (b) => fmt(b.amount),
    },
    {
      key: 'items',
      label: 'Items',
      render: (b) => {
        const itemCount = b.line_items?.length || 0;
        return (
          <Badge label={`${itemCount} items`} variant="secondary" />
        );
      },
    },
    {
      key: 'balance',
      label: 'Balance',
      align: 'right',
      render: (b) => {
        const balance = getOutstanding(b);
        if (balance < 0) {
          return (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontWeight: 500, color: '#1d4ed8' }}>{fmt(balance)}</span>
              <Badge label="Vendor Credit" variant="secondary" />
            </div>
          );
        }
        return <span style={{ fontWeight: 500, color: balance > 0 ? '#dc2626' : '#15803d' }}>{fmt(balance)}</span>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (b) => {
        const displayStatus = b.status === 'VOID' || b.is_voided
          ? 'VOID'
          : b.status === 'UNPAID' && parseFloat(b.amount_paid) > 0
            ? 'PARTIAL'
            : b.status;
        return (
          <Badge
            label={displayStatus}
            variant={
              displayStatus === 'PAID'
                ? 'success'
                : displayStatus === 'VOID'
                  ? 'secondary'
                  : displayStatus === 'PARTIAL'
                    ? 'info'
                    : 'warning'
            }
          />
        );
      },
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (b) => (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {!b.is_voided && b.status === 'UNPAID' && canEdit && getOutstanding(b) > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handlePay(b);
              }}
            >
              Pay
            </Button>
          )}
        </div>
      ),
    },
  ];

  const visibleBills = (bills || []).filter((b) => {
    if (showVoided) return true;
    const isVoided = b.status === 'VOID' || b.is_voided;
    return !isVoided;
  });

  const unpaidBills = visibleBills.filter(b => b.status === 'UNPAID');
  const totalUnpaid = unpaidBills.reduce((sum, b) => sum + Math.max(getOutstanding(b), 0), 0);
  const overdueBills = unpaidBills.filter((b) => b.due_date && isDateOnlyBefore(b.due_date, getChurchToday()) && getOutstanding(b) > 0);
  const totalOverdue = overdueBills.reduce((sum, b) => sum + Math.max(getOutstanding(b), 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Bills
        </h1>
        {canEdit && (
          <Button onClick={handleAdd}>+ New Bill</Button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
        
        <Select label="" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          options={statusOptions} style={{ minWidth: '140px' }} />
        
        <Combobox label="" options={vendorOptions} value={vendorFilter}
          onChange={setVendorFilter} placeholder="Filter by vendor…" style={{ minWidth: '140px' }} />

        <label style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          fontSize: '0.85rem',
          color: '#374151',
          fontWeight: 500,
          cursor: 'pointer',
          userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Show voided
        </label>
      </div>

      {(totalUnpaid > 0 || totalOverdue > 0) && (
        <div style={{ marginBottom: '1.25rem', display: 'flex', gap: '1rem' }}>
          {totalUnpaid > 0 && (
            <div style={{ padding: '0.75rem 1.25rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
              <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: 600 }}>Total Unpaid</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#92400e' }}>{fmt(totalUnpaid)}</div>
            </div>
          )}
          {totalOverdue > 0 && (
            <div style={{ padding: '0.75rem 1.25rem', background: '#fee2e2', borderRadius: '8px', border: '1px solid #fca5a5' }}>
              <div style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 600 }}>Overdue</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#991b1b' }}>{fmt(totalOverdue)} ({overdueBills.length} bills)</div>
            </div>
          )}
        </div>
      )}

       <Card>
        <Table columns={COLUMNS} rows={visibleBills} isLoading={isLoading}
          emptyText="No bills found."
          onRowClick={handleRowClick}
          rowStyle={(bill) => bill.is_voided ? { 
            opacity: 0.6, 
            textDecoration: 'line-through' 
          } : {}} />
      </Card>

      <Drawer isOpen={!!drawer} onClose={() => setDrawer(null)}
        title={isAddDrawer ? 'New Bill' : isViewDrawer ? 'Bill Details' : 'Edit Bill'} width="850px">
        {activeBill && (
          <BillForm
            bill={activeBill}
            onClose={() => setDrawer(null)}
            onSaved={() => { setDrawer(null); refetch(); }}
            onVoid={(bill) => handleVoid(bill, { closeDrawer: true })}
            canVoid={canVoid}
            isVoiding={voidBill.isPending}
            readOnly={isViewDrawer}
          />
        )}
        {isAddDrawer && (
          <BillForm onClose={() => setDrawer(null)} onSaved={handleDrawerSaved} />
        )}
      </Drawer>

      <PaymentModal
        bill={paymentBill}
        isOpen={!!paymentBill}
        onClose={() => setPaymentBill(null)}
        onPaid={() => { refetch(); }}
      />
    </div>
  );
}
