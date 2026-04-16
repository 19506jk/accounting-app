import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccounts } from '../../api/useAccounts';
import { useContacts } from '../../api/useContacts';
import { useCreateBill, useUpdateBill } from '../../api/useBills';
import { useFunds } from '../../api/useFunds';
import { useTaxRates } from '../../api/useTaxRates';
import ExpenseBreakdown from '../../components/ExpenseBreakdown';
import Button from '../../components/ui/Button';
import Combobox from '../../components/ui/Combobox';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { getChurchToday, toDateOnly } from '../../utils/date';
import { getErrorMessage } from '../../utils/errors';
import { fmt } from './billHelpers';
import type React from 'react';
import type {
  BillDetail,
  BillLineItemInput,
  BillSummary,
  CreateBillInput,
  TaxRateSummary,
} from '@shared/contracts';
import type { OptionValue, SelectOption } from '../../components/ui/types';

const MAX_ROUNDING = 0.10;
const ROUNDING_PATTERN = /^-?\d*(?:\.\d*)?$/;

type BillType = 'BILL' | 'CREDIT';
type EditableBill = BillSummary | BillDetail;

interface BillLineItemForm {
  id: string;
  expense_account_id: string;
  description: string;
  amount: string;
  tax_rate_id: string;
  rounding_adjustment: string;
}

interface BillFormState {
  bill_type: BillType;
  contact_id: string;
  date: string;
  due_date: string;
  bill_number: string;
  description: string;
  fund_id: string;
  line_items: BillLineItemForm[];
}

type BillLineItemErrors = Partial<Record<keyof BillLineItemForm, string>>;

interface BillFormErrors {
  contact_id?: string;
  date?: string;
  due_date?: string;
  description?: string;
  fund_id?: string;
  line_items?: BillLineItemErrors[];
}

interface LineTotal {
  gross: number;
  net: number;
  tax: number;
  taxName: string | null;
  rounding: number;
}

interface BillTotals {
  lineTotal: number;
  totalHST: number;
  totalGST: number;
  totalTax: number;
  totalRounding: number;
  totalNet: number;
}

interface BillFormProps {
  bill?: EditableBill | null;
  onClose: () => void;
  onSaved?: (savedBill: BillDetail, options?: { andPay?: boolean }) => void;
  onVoid?: (bill: EditableBill) => void;
  canVoid?: boolean;
  isVoiding?: boolean;
  readOnly?: boolean;
}

const billTypeOptions: SelectOption<BillType>[] = [
  { value: 'BILL', label: 'Bill' },
  { value: 'CREDIT', label: 'Credit' },
];

function createEmptyLineItem(tempId: string): BillLineItemForm {
  return {
    id: tempId,
    expense_account_id: '',
    description: '',
    amount: '',
    tax_rate_id: '',
    rounding_adjustment: '',
  };
}

function createEmptyForm(): BillFormState {
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

function normalizeLineAmount(value: string | number, billType: BillType) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const absolute = Math.abs(parsed);
  return billType === 'CREDIT' ? absolute * -1 : absolute;
}

function parseRoundingAdjustment(value: string | number) {
  if (value === '' || value === '-' || value === '.') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function coerceDateOnly(value: string | null | undefined) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const directDateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directDateOnly?.[1]) return directDateOnly[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return toDateOnly(raw);
}

function createFormFromBill(bill: EditableBill): BillFormState {
  return {
    bill_type: Number(bill.amount) < 0 ? 'CREDIT' : 'BILL',
    contact_id: String(bill.contact_id),
    date: coerceDateOnly(bill.date),
    due_date: coerceDateOnly(bill.due_date),
    bill_number: bill.bill_number || '',
    description: bill.description || '',
    fund_id: String(bill.fund_id),
    line_items: bill.line_items?.map((lineItem) => ({
      id: `existing-${lineItem.id}`,
      expense_account_id: String(lineItem.expense_account_id),
      description: lineItem.description || '',
      amount: String(Math.abs(parseFloat(String(lineItem.amount || 0))) || ''),
      tax_rate_id: lineItem.tax_rate_id ? String(lineItem.tax_rate_id) : '',
      rounding_adjustment: lineItem.rounding_adjustment != null ? String(lineItem.rounding_adjustment) : '',
    })) || [createEmptyLineItem('temp-1')],
  };
}

function calculateLineTotals(form: BillFormState, taxRateMap: Record<string, TaxRateSummary>): LineTotal[] {
  return form.line_items.map((lineItem) => {
    const net = normalizeLineAmount(lineItem.amount, form.bill_type);
    const rounding = parseRoundingAdjustment(lineItem.rounding_adjustment);
    const taxRate = lineItem.tax_rate_id ? taxRateMap[lineItem.tax_rate_id] : null;
    if (!taxRate || net === 0) {
      return { gross: Math.round((net + rounding) * 100) / 100, net, tax: 0, taxName: null, rounding };
    }
    const tax = Math.round(net * taxRate.rate * 100) / 100;
    const gross = Math.round((net + tax + rounding) * 100) / 100;
    return { gross, net, tax, taxName: taxRate.name, rounding };
  });
}

function calculateTotals(lineTotals: LineTotal[]): BillTotals {
  const lineTotal = Math.round(lineTotals.reduce((sum, line) => sum + line.gross, 0) * 100) / 100;
  const totalHST = lineTotals.filter((line) => line.taxName === 'HST').reduce((sum, line) => sum + line.tax, 0);
  const totalGST = lineTotals.filter((line) => line.taxName === 'GST').reduce((sum, line) => sum + line.tax, 0);
  const totalRounding = lineTotals.reduce((sum, line) => sum + line.rounding, 0);
  const totalNet = lineTotals.reduce((sum, line) => sum + line.net, 0);
  return {
    lineTotal,
    totalHST,
    totalGST,
    totalTax: totalHST + totalGST,
    totalRounding,
    totalNet,
  };
}

export default function BillForm({ bill = null, onClose, onSaved, onVoid, canVoid = false, isVoiding = false, readOnly = false }: BillFormProps) {
  const { addToast } = useToast();
  const { data: contacts } = useContacts({ type: 'PAYEE' });
  const { data: accounts } = useAccounts();
  const { data: funds } = useFunds();
  const { data: taxRates = [] } = useTaxRates({ activeOnly: true });
  const createBill = useCreateBill();
  const updateBill = useUpdateBill();
  const tempIdCounter = useRef(1);

  const [form, setForm] = useState<BillFormState>(bill ? createFormFromBill(bill) : createEmptyForm());
  const [errors, setErrors] = useState<BillFormErrors>({});

  useEffect(() => {
    if (!bill && funds && funds.length > 0 && !form.fund_id) {
      const firstActiveFund = funds.find((fund) => fund.is_active);
      if (firstActiveFund) {
        setForm((current) => ({ ...current, fund_id: String(firstActiveFund.id) }));
      }
    }
  }, [funds, bill, form.fund_id]);

  const vendorOptions = useMemo(
    () => (contacts || [])
      .filter((contact) => ['PAYEE', 'BOTH'].includes(contact.type))
      .map((contact) => ({ value: String(contact.id), label: contact.name })),
    [contacts]
  );

  const expenseAccountOptions = useMemo(
    () => (accounts || [])
      .filter((account) => account.type === 'EXPENSE' && account.is_active)
      .map((account) => ({ value: String(account.id), label: `${account.code} — ${account.name}` })),
    [accounts]
  );

  const fundOptions = useMemo(
    () => (funds || [])
      .filter((fund) => fund.is_active)
      .map((fund) => ({ value: String(fund.id), label: fund.name })),
    [funds]
  );

  const taxRateOptions = useMemo<SelectOption<string>[]>(() => [
    { value: '', label: 'Exempt' },
    ...taxRates.map((taxRate) => ({ value: String(taxRate.id), label: `${taxRate.name} (${(taxRate.rate * 100).toFixed(2)}%)` })),
  ], [taxRates]);

  const taxRateMap = useMemo<Record<string, TaxRateSummary>>(() => {
    return Object.fromEntries(taxRates.map((taxRate) => [String(taxRate.id), taxRate]));
  }, [taxRates]);

  const lineTotals = useMemo<LineTotal[]>(() => calculateLineTotals(form, taxRateMap), [form, taxRateMap]);
  const totals = useMemo(() => calculateTotals(lineTotals), [lineTotals]);
  const amountDelta = bill ? Math.abs(totals.lineTotal - (Number(bill.amount) || 0)) : 0;
  const willRecalculateAmount = Boolean(bill && amountDelta > 0.01);

  const set = (key: keyof Omit<BillFormState, 'line_items'>) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  function addLineItem() {
    tempIdCounter.current += 1;
    setForm((current) => ({
      ...current,
      line_items: [...current.line_items, createEmptyLineItem(`temp-${tempIdCounter.current}`)],
    }));
  }

  function removeLineItem(index: number) {
    if (form.line_items.length <= 1) return;
    setForm((current) => ({
      ...current,
      line_items: current.line_items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function updateLineItem(index: number, field: keyof BillLineItemForm, value: OptionValue | string) {
    setForm((current) => ({
      ...current,
      line_items: current.line_items.map((lineItem, itemIndex) =>
        itemIndex === index ? { ...lineItem, [field]: value } : lineItem
      ),
    }));
  }

  function validate() {
    const nextErrors: BillFormErrors = {};
    if (!form.contact_id) nextErrors.contact_id = 'Vendor is required';
    if (!form.date) nextErrors.date = 'Date is required';

    const lineItemErrors: BillLineItemErrors[] = [];
    let hasLineItemErrors = false;
    form.line_items.forEach((lineItem, index) => {
      const lineError: BillLineItemErrors = {};
      if (!lineItem.expense_account_id) {
        lineError.expense_account_id = 'Required';
        hasLineItemErrors = true;
      }
      if (!lineItem.amount || parseFloat(lineItem.amount) === 0) {
        lineError.amount = 'Required';
        hasLineItemErrors = true;
      }
      const rawRounding = String(lineItem.rounding_adjustment);
      const rounding = Number(rawRounding);
      if (rawRounding !== '' && (rawRounding === '-' || rawRounding === '.' || !ROUNDING_PATTERN.test(rawRounding) || !Number.isFinite(rounding))) {
        lineError.rounding_adjustment = 'Invalid number';
        hasLineItemErrors = true;
      } else if (Number.isFinite(rounding)) {
        const parts = rawRounding.split('.');
        if (parts[1] && parts[1].length > 2) {
          lineError.rounding_adjustment = 'Max 2 decimal places';
          hasLineItemErrors = true;
        } else if (Math.abs(rounding) > MAX_ROUNDING) {
          lineError.rounding_adjustment = `Cannot exceed ${MAX_ROUNDING.toFixed(2)}`;
          hasLineItemErrors = true;
        }
      }
      if (Object.keys(lineError).length > 0) {
        lineItemErrors[index] = lineError;
      }
    });

    if (hasLineItemErrors) nextErrors.line_items = lineItemErrors;

    if (form.date && form.due_date && form.due_date < form.date) {
      nextErrors.due_date = 'Due date cannot be before bill date';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSave(andPay = false) {
    if (readOnly) return;
    if (!validate()) return;

    try {
      const lineItems: BillLineItemInput[] = form.line_items.map((lineItem) => ({
        expense_account_id: parseInt(lineItem.expense_account_id),
        description: lineItem.description.trim(),
        amount: normalizeLineAmount(lineItem.amount, form.bill_type),
        rounding_adjustment: parseRoundingAdjustment(lineItem.rounding_adjustment),
        tax_rate_id: lineItem.tax_rate_id ? parseInt(lineItem.tax_rate_id) : null,
      }));
      const payload: CreateBillInput = {
        contact_id: parseInt(form.contact_id),
        date: form.date,
        due_date: form.due_date,
        bill_number: form.bill_number || null,
        description: form.description,
        amount: totals.lineTotal,
        fund_id: parseInt(form.fund_id),
        line_items: lineItems,
      };

      let savedBill: BillDetail;
      if (bill) {
        try {
          savedBill = await updateBill.mutateAsync({ id: bill.id, ...payload });
        } catch (innerErr) {
          const errMsg = getErrorMessage(innerErr, '');
          if (errMsg.includes('Confirm unapply')) {
            const confirmed = window.confirm(
              'This bill has applied credits. Updating it will unapply existing credits first. You will need to manually re-apply credits after saving. Continue?'
            );
            if (!confirmed) return;
            savedBill = await updateBill.mutateAsync({ id: bill.id, ...payload, confirm_unapply_credits: true });
          } else {
            throw innerErr;
          }
        }
        addToast('Bill updated.', 'success');
      } else {
        savedBill = await createBill.mutateAsync(payload);
        addToast('Bill created.', 'success');
      }

      onSaved?.(savedBill, { andPay });
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to save.');
      addToast(msg, 'error');
    }
  }

  const isSaving = createBill.isPending || updateBill.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <Combobox label="Vendor" required options={vendorOptions} value={form.contact_id}
            onChange={(value) => setForm((current) => ({ ...current, contact_id: String(value) }))} placeholder="Select vendor…"
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
          onChange={(value) => setForm((current) => ({ ...current, fund_id: String(value) }))} placeholder="Select fund…"
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
          {bill && willRecalculateAmount && (
            <div style={{ color: '#92400e', fontWeight: 600 }}>
              Saving this bill will update stored amount from {fmt(bill.amount)} to {fmt(totals.lineTotal)}.
            </div>
          )}
          {totals.totalTax !== 0 && (
            <>
              <div style={{ color: '#6b7280' }}>
                Subtotal (net): <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totals.totalNet)}</span>
              </div>
              {totals.totalHST !== 0 && (
                <div style={{ color: '#6b7280' }}>
                  HST: <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totals.totalHST)}</span>
                </div>
              )}
              {totals.totalGST !== 0 && (
                <div style={{ color: '#6b7280' }}>
                  GST: <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totals.totalGST)}</span>
                </div>
              )}
              {totals.totalRounding !== 0 && (
                <div style={{ color: '#6b7280' }}>
                  Rounding: <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totals.totalRounding)}</span>
                </div>
              )}
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.3rem', marginTop: '0.1rem' }}>
                Grand Total: <span style={{ fontWeight: 700, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totals.lineTotal)}</span>
              </div>
            </>
          )}
          {totals.totalTax === 0 && (
            <>
              {totals.totalRounding !== 0 && (
                <div style={{ color: '#6b7280' }}>
                  Rounding: <span style={{ fontWeight: 500, color: '#1e293b', marginLeft: '1rem' }}>{fmt(totals.totalRounding)}</span>
                </div>
              )}
              <span style={{ fontWeight: 600, color: '#1e293b' }}>Total: {fmt(totals.lineTotal)}</span>
            </>
          )}
        </div>

        {form.line_items.length > 0 && form.fund_id && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: '0.5rem' }}>
              Journal Entry Preview
            </div>
            <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
              {form.line_items.map((lineItem, index) => {
                const account = expenseAccountOptions.find((option) => option.value === lineItem.expense_account_id);
                const lineTotal = lineTotals[index];
                if (!lineTotal) return null;
                const { gross, net, tax, taxName, rounding = 0 } = lineTotal;
                if (!gross || gross === 0) return null;
                const taxRate = lineItem.tax_rate_id ? taxRateMap[lineItem.tax_rate_id] : null;

                return (
                  <div key={lineItem.id}>
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
              <div style={{ color: totals.lineTotal >= 0 ? '#b91c1c' : '#15803d', marginTop: '0.25rem', fontWeight: 500 }}>
                {totals.lineTotal >= 0 ? 'Cr' : 'Dr'} Accounts Payable (20000) — {fmt(Math.abs(totals.lineTotal))}
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
