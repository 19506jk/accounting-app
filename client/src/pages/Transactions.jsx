import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Decimal from 'decimal.js';
import { useTransactions, useCreateTransaction, useUpdateTransaction, useDeleteTransaction } from '../api/useTransactions';
import { useTransactionTemplates } from '../api/useTransactionTemplates';
import { useAccounts }  from '../api/useAccounts';
import { useFunds }     from '../api/useFunds';
import { useContacts }  from '../api/useContacts';
import { useToast }     from '../components/ui/Toast';
import Card        from '../components/ui/Card';
import Modal       from '../components/ui/Modal';
import Button      from '../components/ui/Button';
import Input       from '../components/ui/Input';
import Combobox    from '../components/ui/Combobox';
import Select      from '../components/ui/Select';
import SummaryBar  from '../components/ui/SummaryBar';
import TemplateDropdown from '../components/TemplateDropdown';
import SaveTemplateModal from '../components/SaveTemplateModal';
import DateRangePicker from '../components/ui/DateRangePicker';
import TransactionTable from '../components/ui/TransactionTable';
import { currentMonthRange, getChurchToday, toDateOnly } from '../utils/date';

const dec = (v) => new Decimal(v || 0);

const EMPTY_ENTRY = { account_id: '', fund_id: '', debit: '', credit: '', contact_id: '', memo: '' };
const JOURNAL_GRID_TEMPLATE = 'minmax(250px, 2fr) minmax(150px, 1fr) 110px 110px minmax(220px, 1.2fr) minmax(280px, 1.6fr) 28px';

// ── Shared Journal Entry Form Fields ────────────────────────────────────────
// Used by both TransactionForm (create) and TransactionEditForm (edit)
function JournalEntryLines({
  entries,
  setEntries,
  accountOptions,
  fundOptions,
  contactOptions,
  defaultFundId = '',
}) {
  function setEntry(i, key, val) {
    setEntries((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: val };
      return next;
    });
  }
  function addLine() {
    setEntries((prev) => [...prev, { ...EMPTY_ENTRY, fund_id: defaultFundId || '' }]);
  }
  function removeLine(i) {
    if (entries.length <= 2) return;
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <>
      <div style={{ fontSize: '0.775rem', fontWeight: 600, color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
        Journal Entries
      </div>

      <div className="journal-scroll-container">
        <div className="journal-table">
          <div className="journal-grid journal-grid-header" style={{ gridTemplateColumns: JOURNAL_GRID_TEMPLATE }}>
            <span>Account</span><span>Fund</span>
            <span style={{ textAlign: 'right' }}>Debit</span>
            <span style={{ textAlign: 'right' }}>Credit</span>
            <span>Donor / Payee</span>
            <span>Description</span>
            <span />
          </div>

          {entries.map((e, i) => (
            <div key={i} className="journal-grid journal-grid-row" style={{ gridTemplateColumns: JOURNAL_GRID_TEMPLATE }}>
              <Combobox options={accountOptions} value={e.account_id}
                onChange={(v) => setEntry(i, 'account_id', v)} placeholder="Account…" />
              <Combobox options={fundOptions} value={e.fund_id}
                onChange={(v) => setEntry(i, 'fund_id', v)} placeholder="Fund…" />
              <input type="number" min="0" step="0.01" value={e.debit}
                onChange={(ev) => {
                  const value = ev.target.value;
                  setEntries((prev) => {
                    const next = [...prev];
                    next[i] = { ...next[i], debit: value };

                    if (value) {
                      next[i] = { ...next[i], credit: '' };
                    }

                    return next;
                  });
                }}
                placeholder="0.00"
                style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db',
                  borderRadius: '6px', fontSize: '0.8rem', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
              <input type="number" min="0" step="0.01" value={e.credit}
                onChange={(ev) => {
                  setEntry(i, 'credit', ev.target.value);
                  if (ev.target.value) setEntry(i, 'debit', '');
                }}
                placeholder="0.00"
                style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db',
                  borderRadius: '6px', fontSize: '0.8rem', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
              <Combobox options={contactOptions} value={e.contact_id}
                onChange={(v) => setEntry(i, 'contact_id', v)} placeholder="Anonymous" />
              <input type="text" value={e.memo}
                onChange={(ev) => setEntry(i, 'memo', ev.target.value)}
                placeholder="Line description"
                style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db',
                  borderRadius: '6px', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }} />
              <button onClick={() => removeLine(i)}
                disabled={entries.length <= 2}
                style={{ background: 'none', border: 'none', cursor: entries.length > 2 ? 'pointer' : 'not-allowed',
                  color: entries.length > 2 ? '#ef4444' : '#e5e7eb', fontSize: '1rem', padding: 0 }}>
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <Button variant="secondary" size="sm" onClick={addLine} style={{ alignSelf: 'flex-start' }}>
        + Add Line
      </Button>
    </>
  );
}

// ── New Transaction Form ─────────────────────────────────────────────────────
function TransactionForm({ onClose, onSaved }) {
  const { addToast }  = useToast();
  const { data: accounts  } = useAccounts();
  const { data: funds     } = useFunds();
  const { data: contacts  } = useContacts();
  const createTx = useCreateTransaction();

  const today = getChurchToday();
  const [form, setForm] = useState({ date: today, description: '', reference_no: '' });
  const [entries, setEntries] = useState([{ ...EMPTY_ENTRY }, { ...EMPTY_ENTRY }]);
  const [errors, setErrors] = useState([]);
  const { templates, saveTemplate, deleteTemplate } = useTransactionTemplates();
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const dropdownRef = useRef(null);

  const accountOptions = (accounts || []).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
  const fundOptions    = (funds    || []).filter((f) => f.is_active).map((f) => ({ value: f.id, label: f.name }));
  const contactOptions = [{ value: '', label: 'Anonymous' }, ...(contacts || []).map((c) => ({ value: c.id, label: c.name }))];
  const defaultFundId = fundOptions.length > 0 ? fundOptions[0].value : '';

  useEffect(() => {
    if (!defaultFundId) return;
    setEntries((prev) => {
      let changed = false;
      const next = prev.map((entry) => {
        if (entry.fund_id !== '') return entry;
        changed = true;
        return { ...entry, fund_id: defaultFundId };
      });
      return changed ? next : prev;
    });
  }, [defaultFundId]);

  useEffect(() => {
    if (!templateDropdownOpen) return;

    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setTemplateDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [templateDropdownOpen]);

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
      return { name: fund?.name || `Fund #${fundId}`, balanced: t.debit.equals(t.credit),
        debit: parseFloat(t.debit.toFixed(2)), credit: parseFloat(t.credit.toFixed(2)) };
    });
  }, [entries, funds]);

  const totalDebit  = parseFloat(entries.reduce((s, e) => s.plus(dec(e.debit)),  dec(0)).toFixed(2));
  const totalCredit = parseFloat(entries.reduce((s, e) => s.plus(dec(e.credit)), dec(0)).toFixed(2));
  const allBalanced = fundStatuses.every((f) => f.balanced) && Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  function loadTemplate(template) {
    const accountValueById = new Map(accountOptions.map((option) => [String(option.value), option.value]));
    const fundValueById = new Map(fundOptions.map((option) => [String(option.value), option.value]));
    const contactValueById = new Map(contactOptions.map((option) => [String(option.value), option.value]));

    setForm((prev) => ({ ...prev, description: template.description || '' }));
    setEntries(
      template.rows.map((row) => ({
        account_id: accountValueById.get(String(row.account_id)) || '',
        fund_id: fundValueById.get(String(row.fund_id)) || (defaultFundId || ''),
        contact_id: contactValueById.get(String(row.contact_id)) || '',
        memo: row.memo || '',
        debit: '',
        credit: '',
      }))
    );
    setTemplateDropdownOpen(false);
    addToast(`Template "${template.name}" loaded.`, 'success');
  }

  async function handleSubmit() {
    setErrors([]);
    const nextReferenceNo = form.reference_no.trim()
    const payload = {
      date:         form.date,
      description:  form.description,
      reference_no: nextReferenceNo || null,
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
    <div className="tx-modal-layout">
      <div className="tx-form-main">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={() => setSaveModalOpen(true)}>
            Save as Template
          </Button>
          <TemplateDropdown
            ref={dropdownRef}
            templates={templates}
            isOpen={templateDropdownOpen}
            onToggle={() => setTemplateDropdownOpen((value) => !value)}
            onLoad={loadTemplate}
            onDelete={(id) => {
              const errorMessage = deleteTemplate(id);
              if (errorMessage) {
                addToast(errorMessage, 'error');
                return;
              }
              addToast('Template deleted.', 'success');
            }}
          />
        </div>
        <div className="tx-top-fields">
          <Input label="Date" required type="date" value={form.date}
            style={{ flex: '1 1 160px', minWidth: '160px' }}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          <Input label="Description" required value={form.description}
            style={{ flex: '2 1 320px', minWidth: '280px' }}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="" />
          <Input label="Reference No" value={form.reference_no}
            style={{ flex: '1 1 160px', minWidth: '160px' }}
            onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value }))}
            placeholder="DEP-001" />
        </div>

        <div className="tx-journal-section">
          <JournalEntryLines
            entries={entries} setEntries={setEntries}
            accountOptions={accountOptions} fundOptions={fundOptions} contactOptions={contactOptions}
            defaultFundId={defaultFundId}
          />
        </div>

        {errors.length > 0 && (
          <div style={{ marginTop: '1rem', background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '8px', padding: '0.75rem 1rem' }}>
            {errors.map((err, i) => (
              <div key={i} style={{ fontSize: '0.8rem', color: '#dc2626' }}>• {err}</div>
            ))}
          </div>
        )}
      </div>

      <div className="tx-summary-shell">
        <SummaryBar
          totalDebit={totalDebit}
          totalCredit={totalCredit}
          fundStatuses={fundStatuses}
          style={{ position: 'relative', bottom: 'auto' }}
        />
      </div>

      <div className="tx-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isLoading={createTx.isPending} disabled={!allBalanced}>
          Save Transaction
        </Button>
      </div>

      <SaveTemplateModal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save Transaction Template"
        placeholder="Template Name"
        onSave={(name) => {
          const errorMessage = saveTemplate(name, form, entries);
          if (errorMessage) return errorMessage;
          addToast(`Template "${name.trim()}" saved.`, 'success');
          setSaveModalOpen(false);
          return null;
        }}
      />
    </div>
  );
}

// ── Edit Transaction Form ────────────────────────────────────────────────────
function TransactionEditForm({ transaction, onClose, onSaved }) {
  const { addToast } = useToast();
  const { data: accounts } = useAccounts();
  const { data: funds     } = useFunds();
  const { data: contacts  } = useContacts();
  const updateTx = useUpdateTransaction();

  const [form, setForm] = useState({
    date:         toDateOnly(String(transaction.date || '')),
    description:  transaction.description ?? '',
    reference_no: transaction.reference_no ?? '',
  });

  const [entries, setEntries] = useState(
    (transaction.entries || []).map((e) => ({
      account_id: e.account_id ?? '',
      fund_id:    e.fund_id    ?? '',
      debit:      e.debit  > 0 ? String(e.debit)  : '',
      credit:     e.credit > 0 ? String(e.credit) : '',
      contact_id: e.contact_id ?? '',
      memo:       e.memo ?? '',
    }))
  );

  const [errors, setErrors] = useState([]);

  const accountOptions = (accounts || []).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
  const fundOptions    = (funds    || []).filter((f) => f.is_active).map((f) => ({ value: f.id, label: f.name }));
  const contactOptions = [{ value: '', label: 'Anonymous' }, ...(contacts || []).map((c) => ({ value: c.id, label: c.name }))];

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
      return { name: fund?.name || `Fund #${fundId}`, balanced: t.debit.equals(t.credit),
        debit: parseFloat(t.debit.toFixed(2)), credit: parseFloat(t.credit.toFixed(2)) };
    });
  }, [entries, funds]);

  const totalDebit  = parseFloat(entries.reduce((s, e) => s.plus(dec(e.debit)),  dec(0)).toFixed(2));
  const totalCredit = parseFloat(entries.reduce((s, e) => s.plus(dec(e.credit)), dec(0)).toFixed(2));
  const allBalanced = fundStatuses.every((f) => f.balanced) && Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  async function handleSubmit() {
    setErrors([]);
    const nextReferenceNo = form.reference_no.trim()
    const payload = {
      date:         form.date,
      description:  form.description,
      reference_no: nextReferenceNo || null,
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
      await updateTx.mutateAsync({ id: transaction.id, ...payload });
      addToast('Transaction updated.', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      const errs = err.response?.data?.errors || [err.response?.data?.error || 'Failed to update.'];
      setErrors(errs);
    }
  }

  return (
    <div className="tx-modal-layout">
      <div className="tx-form-main">
        <div className="tx-top-fields">
          <Input label="Date" required type="date" value={form.date}
            style={{ flex: '1 1 160px', minWidth: '160px' }}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          <Input label="Description" required value={form.description}
            style={{ flex: '2 1 320px', minWidth: '280px' }}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="" />
          <Input label="Reference No" value={form.reference_no}
            style={{ flex: '1 1 160px', minWidth: '160px' }}
            onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value }))}
            placeholder="DEP-001" />
        </div>

        <div className="tx-journal-section">
          <JournalEntryLines
            entries={entries} setEntries={setEntries}
            accountOptions={accountOptions} fundOptions={fundOptions} contactOptions={contactOptions}
          />
        </div>

        {errors.length > 0 && (
          <div style={{ marginTop: '1rem', background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '8px', padding: '0.75rem 1rem' }}>
            {errors.map((err, i) => (
              <div key={i} style={{ fontSize: '0.8rem', color: '#dc2626' }}>• {err}</div>
            ))}
          </div>
        )}
      </div>

      <div className="tx-summary-shell">
        <SummaryBar
          totalDebit={totalDebit}
          totalCredit={totalCredit}
          fundStatuses={fundStatuses}
          style={{ position: 'relative', bottom: 'auto' }}
        />
      </div>

      <div className="tx-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isLoading={updateTx.isPending} disabled={!allBalanced}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}

// ── Transaction List Page ────────────────────────────────────────────────────
export default function Transactions() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [range,      setRange]      = useState(currentMonthRange());
  const [typeFilter, setTypeFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [expanded,   setExpanded]   = useState(null);
  const [editingTx,  setEditingTx]  = useState(null); // holds the full transaction object

  const { data: accounts } = useAccounts({ include_inactive: true });
  const { data, isLoading } = useTransactions({
    from: range.from,
    to: range.to,
    limit: 100,
    account_id: accountFilter || undefined,
    transaction_type: typeFilter || undefined,
    include_inactive: showInactive ? 'true' : undefined,
  });
  const deleteTx = useDeleteTransaction();
  const typeOptions = [
    { value: '', label: 'All Types' },
    { value: 'deposit', label: 'Deposit' },
    { value: 'withdrawal', label: 'Withdrawal' },
    { value: 'transfer', label: 'Transfer' },
  ];
  const accountOptions = [
    { value: '', label: 'All Accounts' },
    ...(accounts || []).map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` })),
  ];
  const transactions = data?.transactions || [];

  async function handleDelete(e, id) {
    e.stopPropagation(); // prevent row click from firing
    if (!confirm('Delete this transaction? This cannot be undone.')) return;
    try {
      await deleteTx.mutateAsync(id);
      addToast('Transaction deleted.', 'success');
      setExpanded(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot delete.', 'error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Transactions
        </h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button onClick={() => setShowForm(true)}>+ New Transaction</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
        <Select
          label="Type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          options={typeOptions}
          style={{ minWidth: '140px' }}
        />
        <Combobox
          label="Account"
          options={accountOptions}
          value={accountFilter}
          onChange={setAccountFilter}
          placeholder="All Accounts"
          style={{ minWidth: '220px' }}
        />
        <label style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem',
          color: '#334155',
          marginBottom: '0.35rem',
        }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>

      <Card>
        <TransactionTable
          rows={transactions}
          isLoading={isLoading}
          emptyText="No transactions match the selected filters."
          onDelete={handleDelete}
          onEdit={setEditingTx}
          expandedId={expanded}
          onExpandedChange={setExpanded}
        />
      </Card>

      {/* New Transaction Modal */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)}
        title="New Transaction" width="1280px" adaptiveOnMobile className="tx-modal-shell" bodyStyle={{ padding: 0, overflow: 'hidden' }}>
        <TransactionForm onClose={() => setShowForm(false)} />
      </Modal>

      {/* Edit Transaction Modal */}
      <Modal isOpen={!!editingTx} onClose={() => setEditingTx(null)}
        title="Edit Transaction" width="1280px" adaptiveOnMobile className="tx-modal-shell" bodyStyle={{ padding: 0, overflow: 'hidden' }}>
        {editingTx && (
          <TransactionEditForm
            transaction={editingTx}
            onClose={() => setEditingTx(null)}
            onSaved={() => setExpanded(null)}
          />
        )}
      </Modal>

    </div>
  );
}
