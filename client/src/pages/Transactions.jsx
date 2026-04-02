import { useState, useMemo } from 'react';
import Decimal from 'decimal.js';
import { useTransactions, useCreateTransaction, useDeleteTransaction } from '../api/useTransactions';
import { useAccounts }  from '../api/useAccounts';
import { useFunds }     from '../api/useFunds';
import { useContacts }  from '../api/useContacts';
import { useToast }     from '../components/ui/Toast';
import Card        from '../components/ui/Card';
import Table       from '../components/ui/Table';
import Modal       from '../components/ui/Modal';
import Button      from '../components/ui/Button';
import Input       from '../components/ui/Input';
import Combobox    from '../components/ui/Combobox';
import SummaryBar  from '../components/ui/SummaryBar';
import DateRangePicker from '../components/ui/DateRangePicker';

const dec = (v) => new Decimal(v || 0);
const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });

function currentMonth() {
  const n = new Date();
  return {
    from: new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split('T')[0],
    to:   n.toISOString().split('T')[0],
  };
}

const EMPTY_ENTRY = { account_id: '', fund_id: '', debit: '', credit: '', contact_id: '', memo: '' };

// ── New Transaction Form ─────────────────────────────────────────────────────
function TransactionForm({ onClose, onSaved }) {
  const { addToast }  = useToast();
  const { data: accounts  } = useAccounts();
  const { data: funds     } = useFunds();
  const { data: contacts  } = useContacts({ type: 'DONOR' });
  const createTx = useCreateTransaction();

  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({ date: today, description: '', reference_no: '' });
  const [entries, setEntries] = useState([
    { ...EMPTY_ENTRY }, { ...EMPTY_ENTRY },
  ]);
  const [errors, setErrors] = useState([]);

  // Header-level contact for expenses — auto-fills all debit lines
  const [headerContact, setHeaderContact] = useState('');

  const accountOptions = (accounts || []).map((a) => ({
    value: a.id, label: `${a.code} — ${a.name}`,
  }));
  const fundOptions = (funds || []).filter((f) => f.is_active).map((f) => ({
    value: f.id, label: f.name,
  }));
  const contactOptions = [
    { value: '', label: 'Anonymous' },
    ...(contacts || []).map((c) => ({ value: c.id, label: c.name })),
  ];

  function setEntry(i, key, val) {
    setEntries((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: val };
      return next;
    });
  }

  function addLine() { setEntries((prev) => [...prev, { ...EMPTY_ENTRY }]); }
  function removeLine(i) {
    if (entries.length <= 2) return;
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Auto-fill header contact onto all debit (expense) lines
  function handleHeaderContactChange(val) {
    setHeaderContact(val);
    setEntries((prev) => prev.map((e) =>
      dec(e.debit).gt(0) ? { ...e, contact_id: val } : e
    ));
  }

  // Per-fund balance status for SummaryBar
  const fundStatuses = useMemo(() => {
    const totals = {};
    entries.forEach((e) => {
      if (!e.fund_id) return;
      if (!totals[e.fund_id]) totals[e.fund_id] = { debit: dec(0), credit: dec(0) };
      totals[e.fund_id].debit  = totals[e.fund_id].debit.plus(dec(e.debit));
      totals[e.fund_id].credit = totals[e.fund_id].credit.plus(dec(e.credit));
    });
    return Object.entries(totals).map(([fundId, t]) => {
      const fund = (funds || []).find((f) => f.id === Number(fundId));
      return {
        name:     fund?.name || `Fund #${fundId}`,
        balanced: t.debit.equals(t.credit),
        debit:    parseFloat(t.debit.toFixed(2)),
        credit:   parseFloat(t.credit.toFixed(2)),
      };
    });
  }, [entries, funds]);

  const totalDebit  = parseFloat(entries.reduce((s, e) => s.plus(dec(e.debit)),  dec(0)).toFixed(2));
  const totalCredit = parseFloat(entries.reduce((s, e) => s.plus(dec(e.credit)), dec(0)).toFixed(2));
  const allBalanced = fundStatuses.every((f) => f.balanced) && Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  async function handleSubmit() {
    setErrors([]);
    const payload = {
      date:         form.date,
      description:  form.description,
      reference_no: form.reference_no || undefined,
      entries: entries.map((e) => ({
        account_id: Number(e.account_id),
        fund_id:    Number(e.fund_id),
        debit:      parseFloat(e.debit  || 0),
        credit:     parseFloat(e.credit || 0),
        contact_id: e.contact_id ? Number(e.contact_id) : null,
        memo:       e.memo || undefined,
      })),
    };
    try {
      await createTx.mutateAsync(payload);
      addToast('Transaction saved.', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      const errs = err.response?.data?.errors || [err.response?.data?.error || 'Failed to save.'];
      setErrors(errs);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 160px', gap: '1rem', marginBottom: '1.5rem' }}>
          <Input label="Date" required type="date" value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          <Input label="Description" required value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Sunday Offering" />
          <Input label="Reference No" value={form.reference_no}
            onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value }))}
            placeholder="DEP-001" />
        </div>

        {/* Payee shortcut — auto-fills debit lines */}
        <div style={{ marginBottom: '1.25rem', maxWidth: '320px' }}>
          <Combobox label="Payee / Vendor (auto-fills expense lines)"
            options={contactOptions} value={headerContact}
            onChange={handleHeaderContactChange} placeholder="Select payee…" />
        </div>

        {/* Journal Entry Lines */}
        <div style={{ fontSize: '0.775rem', fontWeight: 600, color: '#6b7280',
          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
          Journal Entries
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'visible', marginBottom: '0.75rem' }}>
          {/* Column headers */}
          <div style={{ display: 'grid',
            gridTemplateColumns: '2fr 1fr 90px 90px 1.5fr 28px',
            gap: '0.5rem', padding: '0.5rem 0.75rem',
            background: '#f8fafc', borderBottom: '1px solid #e5e7eb',
            fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>
            <span>Account</span><span>Fund</span>
            <span style={{ textAlign: 'right' }}>Debit</span>
            <span style={{ textAlign: 'right' }}>Credit</span>
            <span>Donor / Payee</span><span />
          </div>

          {entries.map((e, i) => (
            <div key={i} style={{ display: 'grid',
              gridTemplateColumns: '2fr 1fr 90px 90px 1.5fr 28px',
              gap: '0.5rem', padding: '0.5rem 0.75rem',
              borderBottom: i < entries.length - 1 ? '1px solid #f3f4f6' : 'none',
              alignItems: 'center' }}>
              <Combobox options={accountOptions} value={e.account_id}
                onChange={(v) => setEntry(i, 'account_id', v)} placeholder="Account…" />
              <Combobox options={fundOptions} value={e.fund_id}
                onChange={(v) => setEntry(i, 'fund_id', v)} placeholder="Fund…" />
              <input type="number" min="0" step="0.01" value={e.debit}
                onChange={(ev) => {
                  setEntry(i, 'debit', ev.target.value);
                  if (ev.target.value) setEntry(i, 'credit', '');
                  if (ev.target.value && headerContact) setEntry(i, 'contact_id', headerContact);
                }}
                placeholder="0.00"
                style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db',
                  borderRadius: '6px', fontSize: '0.8rem', textAlign: 'right', width: '100%' }} />
              <input type="number" min="0" step="0.01" value={e.credit}
                onChange={(ev) => {
                  setEntry(i, 'credit', ev.target.value);
                  if (ev.target.value) setEntry(i, 'debit', '');
                }}
                placeholder="0.00"
                style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db',
                  borderRadius: '6px', fontSize: '0.8rem', textAlign: 'right', width: '100%' }} />
              <Combobox options={contactOptions} value={e.contact_id}
                onChange={(v) => setEntry(i, 'contact_id', v)} placeholder="Anonymous" />
              <button onClick={() => removeLine(i)}
                disabled={entries.length <= 2}
                style={{ background: 'none', border: 'none', cursor: entries.length > 2 ? 'pointer' : 'not-allowed',
                  color: entries.length > 2 ? '#ef4444' : '#e5e7eb', fontSize: '1rem', padding: 0 }}>
                ×
              </button>
            </div>
          ))}
        </div>

        <Button variant="secondary" size="sm" onClick={addLine}>+ Add Line</Button>

        {/* Errors */}
        {errors.length > 0 && (
          <div style={{ marginTop: '1rem', background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '8px', padding: '0.75rem 1rem' }}>
            {errors.map((err, i) => (
              <div key={i} style={{ fontSize: '0.8rem', color: '#dc2626' }}>• {err}</div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <SummaryBar totalDebit={totalDebit} totalCredit={totalCredit} fundStatuses={fundStatuses} />

      <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb',
        display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isLoading={createTx.isPending} disabled={!allBalanced}>
          Save Transaction
        </Button>
      </div>
    </div>
  );
}

// ── Transaction List Page ────────────────────────────────────────────────────
export default function Transactions() {
  const { addToast } = useToast();
  const [range,    setRange]    = useState(currentMonth());
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const { data, isLoading } = useTransactions({ from: range.from, to: range.to, limit: 100 });
  const deleteTx = useDeleteTransaction();

  const { data: txDetail } = useTransactions({});
  const transactions = data?.transactions || [];

  async function handleDelete(id) {
    if (!confirm('Delete this transaction? This cannot be undone.')) return;
    try {
      await deleteTx.mutateAsync(id);
      addToast('Transaction deleted.', 'success');
      setExpanded(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot delete.', 'error');
    }
  }

  const COLUMNS = [
    { key: 'date', label: 'Date',
      render: (r) => new Date(r.date).toLocaleDateString('en-CA') },
    { key: 'description', label: 'Description', wrap: true },
    { key: 'reference_no', label: 'Ref',
      render: (r) => r.reference_no || <span style={{ color: '#d1d5db' }}>—</span> },
    { key: 'total_amount', label: 'Amount', align: 'right',
      render: (r) => <span style={{ fontWeight: 500 }}>{fmt(r.total_amount)}</span> },
    { key: 'actions', label: '', align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm"
            onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
            {expanded === r.id ? 'Hide' : 'Details'}
          </Button>
          <Button variant="ghost" size="sm" style={{ color: '#dc2626' }}
            onClick={() => handleDelete(r.id)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Transactions
        </h1>
        <Button onClick={() => setShowForm(true)}>+ New Transaction</Button>
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
      </div>

      <Card>
        <Table columns={COLUMNS} rows={transactions} isLoading={isLoading}
          emptyText="No transactions in this date range." />

        {/* Expandable entry detail rows */}
        {transactions.map((tx) => expanded === tx.id && (
          <TransactionDetail key={tx.id} id={tx.id} />
        ))}
      </Card>

      {/* New Transaction Modal (full width) */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)}
        title="New Transaction" width="900px">
        <div style={{ margin: '-1.5rem' }}>
          <TransactionForm onClose={() => setShowForm(false)} />
        </div>
      </Modal>
    </div>
  );
}

function TransactionDetail({ id }) {
  const { data: tx, isLoading } = useTransactions({ limit: 1 });
  // Fetch the specific transaction
  const [detail, setDetail] = useState(null);
  const client = useTransactions;

  // Use direct fetch for detail
  useState(() => {
    import('../api/client').then(({ default: apiClient }) => {
      apiClient.get(`/transactions/${id}`).then(({ data }) => setDetail(data.transaction));
    });
  });

  if (!detail) return (
    <div style={{ padding: '0.75rem 1rem', background: '#f8fafc',
      borderTop: '1px solid #e5e7eb', fontSize: '0.8rem', color: '#6b7280' }}>
      Loading entries…
    </div>
  );

  return (
    <div style={{ padding: '0.75rem 1rem 1rem', background: '#f8fafc',
      borderTop: '1px solid #e5e7eb' }}>
      <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#6b7280' }}>
            <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem', fontWeight: 600 }}>Account</th>
            <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem', fontWeight: 600 }}>Fund</th>
            <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem', fontWeight: 600 }}>Contact</th>
            <th style={{ textAlign: 'right', padding: '0.25rem 0.5rem', fontWeight: 600 }}>Debit</th>
            <th style={{ textAlign: 'right', padding: '0.25rem 0.5rem', fontWeight: 600 }}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {detail.entries.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '0.3rem 0.5rem' }}>{e.account_code} {e.account_name}</td>
              <td style={{ padding: '0.3rem 0.5rem', color: '#6b7280' }}>{e.fund_name}</td>
              <td style={{ padding: '0.3rem 0.5rem', color: '#6b7280' }}>{e.contact_name || '—'}</td>
              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#15803d' }}>
                {e.debit > 0 ? fmt(e.debit) : ''}
              </td>
              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#b91c1c' }}>
                {e.credit > 0 ? fmt(e.credit) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
