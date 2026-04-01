import { useState, useMemo, useEffect } from 'react';
import { useBills, useCreateBill, useUpdateBill, usePayBill, useVoidBill, useBillSummary } from '../api/useBills';
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

const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });

function currentMonth() {
  const n = new Date();
  return {
    from: new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split('T')[0],
    to: n.toISOString().split('T')[0],
  };
}

function createEmptyLineItem(tempId) {
  return {
    id: tempId,
    expense_account_id: '',
    description: '',
    amount: '',
  };
}

const EMPTY_FORM = {
  contact_id: '',
  date: new Date().toISOString().split('T')[0],
  due_date: '',
  bill_number: '',
  description: '',
  fund_id: '',
  line_items: [createEmptyLineItem('temp-1')],
};

let tempIdCounter = 1;

function BillForm({ bill, onClose, onSaved }) {
  const { addToast } = useToast();
  const { data: contacts } = useContacts({ type: 'PAYEE' });
  const { data: accounts } = useAccounts();
  const { data: funds } = useFunds();
  const createBill = useCreateBill();
  const updateBill = useUpdateBill();

  const [form, setForm] = useState(bill ? {
    contact_id: bill.contact_id,
    date: bill.date,
    due_date: bill.due_date,
    bill_number: bill.bill_number || '',
    description: bill.description,
    fund_id: bill.fund_id,
    line_items: bill.line_items?.map((li, idx) => ({
      id: `existing-${li.id}`,
      expense_account_id: String(li.expense_account_id),
      description: li.description,
      amount: li.amount,
    })) || [createEmptyLineItem('temp-1')],
  } : EMPTY_FORM);

  useEffect(() => {
    if (!bill && funds && funds.length > 0 && !form.fund_id) {
      const firstActiveFund = funds.find(f => f.is_active);
      if (firstActiveFund) {
        setForm(f => ({ ...f, fund_id: firstActiveFund.id }));
      }
    }
  }, [funds, bill, form.fund_id]);

  const [errors, setErrors] = useState({});

  const vendorOptions = (contacts || [])
    .filter(c => ['PAYEE', 'BOTH'].includes(c.type))
    .map(c => ({ value: c.id, label: c.name }));

  const expenseAccountOptions = (accounts || [])
    .filter(a => a.type === 'EXPENSE' && a.is_active)
    .map(a => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  const fundOptions = (funds || [])
    .filter(f => f.is_active)
    .map(f => ({ value: f.id, label: f.name }));

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const lineTotal = useMemo(() => {
    return form.line_items.reduce((sum, li) => {
      const amt = parseFloat(li.amount) || 0;
      return sum + amt;
    }, 0);
  }, [form.line_items]);

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
    if (!validate()) return;

    try {
      const payload = {
        contact_id: form.contact_id,
        date: form.date,
        due_date: form.due_date || null,
        bill_number: form.bill_number || null,
        description: form.description,
        amount: lineTotal,
        fund_id: form.fund_id,
        line_items: form.line_items.map(li => ({
          expense_account_id: parseInt(li.expense_account_id),
          description: li.description.trim(),
          amount: parseFloat(li.amount),
        })),
      };

      if (bill) {
        await updateBill.mutateAsync({ id: bill.id, ...payload });
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
            error={errors.contact_id} />
          <Input label="Bill Number" value={form.bill_number} onChange={set('bill_number')}
            placeholder="e.g., INV-001" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <Input label="Bill Date" required type="date" value={form.date} onChange={set('date')}
            error={errors.date} />
          <Input label="Due Date" type="date" value={form.due_date} onChange={set('due_date')}
            error={errors.due_date} />
        </div>

        <Input label="Description" value={form.description} onChange={set('description')}
          placeholder="e.g., Office supplies" error={errors.description}
          style={{ marginBottom: '1rem' }} />

        <Combobox label="Fund" required options={fundOptions} value={form.fund_id}
          onChange={(v) => setForm((f) => ({ ...f, fund_id: v }))} placeholder="Select fund…"
          error={errors.fund_id} style={{ marginBottom: '1.5rem' }} />

        <div style={{ marginBottom: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '0.5rem' }}>
            Expense Lines
          </label>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'visible', marginBottom: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', width: '38%', fontWeight: 500, color: '#6b7280' }}>Account</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', width: '32%', fontWeight: 500, color: '#6b7280' }}>Description</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', width: '20%', fontWeight: 500, color: '#6b7280' }}>Amount</th>
                <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', width: '10%', fontWeight: 500, color: '#6b7280' }}></th>
              </tr>
            </thead>
            <tbody>
              {form.line_items.map((line, idx) => (
                <tr key={line.id} style={{ borderBottom: idx < form.line_items.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                  <td style={{ padding: '0.5rem' }}>
                    <Combobox
                      options={expenseAccountOptions}
                      value={line.expense_account_id}
                      onChange={(v) => updateLineItem(idx, 'expense_account_id', v)}
                      placeholder="Select..."
                      error={errors.line_items?.[idx]?.expense_account_id}
                    />
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <Input
                      value={line.description}
                      onChange={(e) => updateLineItem(idx, 'description', e.target.value)}
                      placeholder="Description"
                      error={errors.line_items?.[idx]?.description}
                    />
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <Input
                      type="number"
                      step="0.01"
                      value={line.amount}
                      onChange={(e) => updateLineItem(idx, 'amount', e.target.value)}
                      placeholder="0.00"
                      error={errors.line_items?.[idx]?.amount}
                      style={{ textAlign: 'right' }}
                    />
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                    {form.line_items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLineItem(idx)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#dc2626',
                          fontSize: '1rem',
                          padding: '0.25rem',
                        }}
                        title="Remove line"
                      >
                        🗑️
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button variant="secondary" size="sm" onClick={addLineItem} style={{ marginBottom: '1.5rem' }}>
          + Add Expense Line
        </Button>

        <div style={{ 
          display: 'flex', 
          justifyContent: 'flex-end', 
          padding: '0.75rem 1rem', 
          background: '#f9fafb', 
          borderRadius: '8px',
          marginBottom: '1.5rem',
        }}>
          <span style={{ fontWeight: 600, color: '#1e293b' }}>Total: {fmt(lineTotal)}</span>
        </div>

        {form.line_items.length > 0 && form.fund_id && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: '0.5rem' }}>
              Journal Entry Preview
            </div>
            <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
              {form.line_items.map((li, idx) => {
                const account = expenseAccountOptions.find(a => a.value === li.expense_account_id);
                const amount = parseFloat(li.amount) || 0;
                if (amount === 0) return null;
                return (
                  <div key={idx} style={{ color: amount >= 0 ? '#15803d' : '#b91c1c' }}>
                    {amount >= 0 ? 'Dr' : 'Cr'} {account?.label || 'Expense'} — {fmt(amount)}
                  </div>
                );
              })}
              <div style={{ color: '#b91c1c', marginTop: '0.25rem', fontWeight: 500 }}>
                Cr Accounts Payable (20000) — {fmt(lineTotal)}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {!bill && (
          <Button variant="secondary" onClick={() => handleSave(true)} isLoading={isSaving}>
            Save & Pay
          </Button>
        )}
        <Button onClick={() => handleSave(false)} isLoading={isSaving}>
          {bill ? 'Update' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function PaymentModal({ bill, isOpen, onClose, onPaid }) {
  const { addToast } = useToast();
  const payBill = usePayBill();
  const { data: accounts } = useAccounts();

  const [payment, setPayment] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    amount: bill ? parseFloat(bill.amount) - parseFloat(bill.amount_paid) : 0,
    bank_account_id: '',
    reference_no: '',
    memo: '',
  });

  const bankAccountOptions = (accounts || [])
    .filter(a => a.type === 'ASSET' && a.is_active)
    .map(a => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  const outstanding = bill ? parseFloat(bill.amount) - parseFloat(bill.amount_paid) : 0;

  async function handlePay() {
    if (!payment.bank_account_id) {
      addToast('Please select a bank account.', 'error');
      return;
    }

    if (payment.amount === '' || payment.amount === 0) {
      addToast('Please enter a payment amount.', 'error');
      return;
    }

    try {
      await payBill.mutateAsync({ id: bill.id, ...payment });
      addToast('Bill paid.', 'success');
      onPaid?.();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.errors?.[0] || 'Failed to pay bill.';
      addToast(msg, 'error');
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pay Bill" width="500px">
      {bill && (
        <>
          <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', margin: '-1.5rem -1.5rem 1.5rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              <div><strong>Vendor:</strong> {bill.vendor_name}</div>
              <div><strong>Bill #:</strong> {bill.bill_number || '—'}</div>
              <div><strong>Amount:</strong> {fmt(bill.amount)}</div>
              <div><strong>Outstanding:</strong> <span style={{ color: '#dc2626', fontWeight: 600 }}>{fmt(outstanding)}</span></div>
              {bill.line_items && bill.line_items.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <strong>Items:</strong> {bill.line_items.length}
                </div>
              )}
            </div>
          </div>

          <Input label="Payment Date" required type="date" value={payment.payment_date}
            onChange={(e) => setPayment((p) => ({ ...p, payment_date: e.target.value }))}
            style={{ marginBottom: '1rem' }} />

          <Input label="Payment Amount" required type="number" min="0.01" step="0.01"
            value={payment.amount}
            onChange={(e) => {
              const value = e.target.value;
              setPayment((p) => ({ ...p, amount: value === '' ? '' : parseFloat(value) || 0 }));
            }}
            style={{ marginBottom: '1rem' }} />

          <Combobox label="Bank Account" required options={bankAccountOptions}
            value={payment.bank_account_id}
            onChange={(v) => setPayment((p) => ({ ...p, bank_account_id: v }))}
            placeholder="Select bank account…" style={{ marginBottom: '1rem' }} />

          <Input label="Reference No" value={payment.reference_no}
            onChange={(e) => setPayment((p) => ({ ...p, reference_no: e.target.value }))}
            placeholder="e.g., Cheque #123" style={{ marginBottom: '1rem' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1.5rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}>Memo</label>
            <textarea
              value={payment.memo}
              onChange={(e) => setPayment((p) => ({ ...p, memo: e.target.value }))}
              rows={2}
              style={{ padding: '0.45rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', marginBottom: '0.5rem' }}>
              Payment Journal Entry
            </div>
            <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
              <div style={{ color: '#15803d' }}>
                Dr Accounts Payable (20000) — {fmt(outstanding)}
              </div>
              <div style={{ color: '#b91c1c' }}>
                Cr {bankAccountOptions.find(a => a.value === payment.bank_account_id)?.label || 'Bank Account'} — {fmt(outstanding)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handlePay} isLoading={payBill.isPending} disabled={outstanding <= 0}>
              Pay Bill
            </Button>
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
  const updateBill = useUpdateBill();
  const payBill = usePayBill();
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

  function handleAdd() {
    setDrawer('add');
  }

  function handleEdit(bill) {
    setDrawer(bill);
  }

  function handlePay(bill) {
    setPaymentBill(bill);
  }

  async function handleVoid(bill) {
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
      refetch();
    } catch (err) {
      addToast(err.response?.data?.errors?.[0] || 'Cannot void bill.', 'error');
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
      render: (b) => new Date(b.date).toLocaleDateString('en-CA'),
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
        const isOverdue = b.status === 'UNPAID' && new Date(b.due_date) < new Date();
        return (
          <span style={{ color: isOverdue ? '#dc2626' : 'inherit', fontWeight: isOverdue ? 600 : 400 }}>
            {new Date(b.due_date).toLocaleDateString('en-CA')}
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
        const balance = parseFloat(b.amount) - parseFloat(b.amount_paid);
        return <span style={{ fontWeight: 500, color: balance > 0 ? '#dc2626' : '#15803d' }}>{fmt(balance)}</span>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (b) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Badge
            label={b.status}
            variant={b.status === 'PAID' ? 'success' : b.status === 'VOID' ? 'secondary' : 'warning'}
          />
          {b.is_voided && (
            <Badge 
              label="VOID" 
              variant="secondary" 
              style={{ 
                background: '#f3f4f6', 
                color: '#6b7280',
                border: '1px dashed #d1d5db',
                fontSize: '0.75rem'
              }} 
            />
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (b) => (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {!b.is_voided && b.status === 'UNPAID' && canEdit && (
            <>
              <Button variant="secondary" size="sm" onClick={() => handlePay(b)}>Pay</Button>
              <Button variant="secondary" size="sm" onClick={() => handleEdit(b)}>Edit</Button>
            </>
          )}
          {!b.is_voided && b.status === 'UNPAID' && canVoid && (
            <Button variant="ghost" size="sm" style={{ color: '#dc2626' }} onClick={() => handleVoid(b)}>
              Void
            </Button>
          )}
        </div>
      ),
    },
  ];

  const unpaidBills = (bills || []).filter(b => b.status === 'UNPAID');
  const totalUnpaid = unpaidBills.reduce((sum, b) => sum + (parseFloat(b.amount) - parseFloat(b.amount_paid)), 0);
  const overdueBills = unpaidBills.filter(b => b.due_date && new Date(b.due_date) < new Date());
  const totalOverdue = overdueBills.reduce((sum, b) => sum + (parseFloat(b.amount) - parseFloat(b.amount_paid)), 0);

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
        <Table columns={COLUMNS} rows={bills || []} isLoading={isLoading}
          emptyText="No bills found."
          rowStyle={(bill) => bill.is_voided ? { 
            opacity: 0.6, 
            textDecoration: 'line-through' 
          } : {}} />
      </Card>

      <Drawer isOpen={!!drawer} onClose={() => setDrawer(null)}
        title={drawer === 'add' ? 'New Bill' : 'Edit Bill'} width="750px">
        {drawer && drawer !== 'add' && (
          <BillForm bill={drawer} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); refetch(); }} />
        )}
        {drawer === 'add' && (
          <BillForm onClose={() => setDrawer(null)} onSaved={handleDrawerSaved} />
        )}
      </Drawer>

      <PaymentModal
        bill={paymentBill}
        isOpen={!!paymentBill}
        onClose={() => setPaymentBill(null)}
        onPaid={() => { setPaymentBill(null); refetch(); }}
      />
    </div>
  );
}