import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import Decimal from 'decimal.js';
import { useTransactions, useCreateTransaction, useUpdateTransaction, useDeleteTransaction, useImportTransactions, useGetBillMatches } from '../api/useTransactions';
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
import { parseStatementCsv } from '../utils/parseStatementCsv';
import { currentMonthRange, formatDateOnlyForDisplay, getChurchToday, toDateOnly } from '../utils/date';

const dec = (v) => new Decimal(v || 0);
const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });

function currentMonth() {
  return currentMonthRange();
}

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
  enableDebitAutofill = false,
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
                    const previousDebit = prev[i]?.debit || '';
                    next[i] = { ...next[i], debit: value };

                    if (value) {
                      next[i] = { ...next[i], credit: '' };
                    }

                    const nextIndex = i + 1;
                    const nextCredit = prev[nextIndex]?.credit || '';
                    const canAutofillNextCredit = !nextCredit || nextCredit === previousDebit;
                    if (enableDebitAutofill && value && nextIndex < next.length && canAutofillNextCredit) {
                      next[nextIndex] = { ...next[nextIndex], credit: value };
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
        <div className="tx-top-fields">
          <Input label="Date" required type="date" value={form.date}
            style={{ flex: '1 1 160px', minWidth: '160px' }}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          <Input label="Description" required value={form.description}
            style={{ flex: '2 1 320px', minWidth: '280px' }}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Sunday Offering" />
          <Input label="Reference No" value={form.reference_no}
            style={{ flex: '1 1 160px', minWidth: '160px' }}
            onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value }))}
            placeholder="DEP-001" />
        </div>

        <div className="tx-journal-section">
          <JournalEntryLines
            entries={entries} setEntries={setEntries}
            accountOptions={accountOptions} fundOptions={fundOptions} contactOptions={contactOptions}
            enableDebitAutofill
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
            placeholder="Sunday Offering" />
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

const PreviewRow = memo(function PreviewRow({ row, index, offsetOptions, onOffsetChange, suggestions, onBillLink }) {
  const isWithdrawal = row.type === 'withdrawal'
  const isLinked = isWithdrawal && !!row.bill_id
  const linkedBill = isLinked ? suggestions.find((suggestion) => suggestion.bill_id === row.bill_id) : null

  return (
    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
      <td style={{ padding: '0.5rem', color: '#6b7280' }}>{index + 1}</td>
      <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{formatDateOnlyForDisplay(row.date)}</td>
      <td style={{ padding: '0.5rem', maxWidth: '260px' }}>{row.description}</td>
      <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>{fmt(row.amount)}</td>
      <td style={{ padding: '0.5rem' }}>
        <span style={{
          display: 'inline-block',
          padding: '0.2rem 0.5rem',
          borderRadius: '999px',
          fontSize: '0.72rem',
          fontWeight: 600,
          color: row.type === 'deposit' ? '#166534' : '#991b1b',
          background: row.type === 'deposit' ? '#dcfce7' : '#fee2e2',
        }}>
          {row.type === 'deposit' ? 'Deposit' : 'Withdrawal'}
        </span>
      </td>
      <td style={{ padding: '0.5rem', minWidth: '260px' }}>
        <Combobox
          options={offsetOptions}
          value={row.offset_account_id}
          onChange={(value) => onOffsetChange(index, Number(value))}
          placeholder="Offset account…"
        />
      </td>
      <td style={{ padding: '0.5rem', minWidth: '260px' }}>
        {!isWithdrawal && <span style={{ color: '#9ca3af' }}>—</span>}
        {isWithdrawal && !isLinked && suggestions.length === 0 && (
          <span style={{ color: '#9ca3af' }}>No suggested bill</span>
        )}
        {isWithdrawal && !isLinked && suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {suggestions.map((suggestion) => (
              <button
                key={`${index}-${suggestion.bill_id}`}
                onClick={() => onBillLink(index, suggestion.bill_id)}
                style={{
                  border: '1px solid #fcd34d',
                  background: '#fffbeb',
                  borderRadius: '999px',
                  padding: '0.3rem 0.55rem',
                  color: '#92400e',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {suggestion.confidence === 'exact' ? 'Exact' : 'Possible'}: Bill {suggestion.bill_number || `#${suggestion.bill_id}`} — {suggestion.vendor_name || 'Unknown vendor'} {fmt(suggestion.balance_due)}
              </button>
            ))}
          </div>
        )}
        {isLinked && (
          <button
            onClick={() => onBillLink(index, null)}
            style={{
              border: '1px solid #86efac',
              background: '#dcfce7',
              borderRadius: '999px',
              padding: '0.3rem 0.55rem',
              color: '#166534',
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {linkedBill?.confidence === 'exact' ? 'Exact' : 'Possible'}: Bill {linkedBill?.bill_number || `#${row.bill_id}`} — {linkedBill?.vendor_name || 'Linked'} {linkedBill ? fmt(linkedBill.balance_due) : ''} (Unlink)
          </button>
        )}
      </td>
    </tr>
  );
});

function ImportCsvModal({ onClose }) {
  const { addToast } = useToast();
  const { data: accounts } = useAccounts();
  const { data: funds } = useFunds();
  const importTransactions = useImportTransactions();
  const getBillMatches = useGetBillMatches();

  const [phase, setPhase] = useState('setup');
  const [bankAccountId, setBankAccountId] = useState('');
  const [defaultOffsetAccountId, setDefaultOffsetAccountId] = useState('');
  const [fundId, setFundId] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [parseWarnings, setParseWarnings] = useState([]);
  const [parseError, setParseError] = useState('');
  const [errors, setErrors] = useState([]);
  const [skippedRows, setSkippedRows] = useState([]);
  const [isParsing, setIsParsing] = useState(false);
  const [suggestionsByRow, setSuggestionsByRow] = useState({});
  const [matchLoadError, setMatchLoadError] = useState('');

  const activeAccounts = useMemo(
    () => (accounts || []).filter((a) => a.is_active),
    [accounts]
  );

  const bankAccountOptions = useMemo(
    () => activeAccounts
      .filter((a) => a.type === 'ASSET')
      .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [activeAccounts]
  );

  const offsetAccountOptions = useMemo(
    () => [
      { value: '', label: 'None' },
      ...activeAccounts
        .filter((a) => a.id !== Number(bankAccountId || 0))
        .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    ],
    [activeAccounts, bankAccountId]
  );

  const fundOptions = useMemo(
    () => (funds || []).filter((f) => f.is_active).map((f) => ({ value: f.id, label: f.name })),
    [funds]
  );

  useEffect(() => {
    if (bankAccountId !== '') return;
    if (bankAccountOptions.length === 0) return;
    setBankAccountId(String(bankAccountOptions[0].value));
  }, [bankAccountOptions]);

  useEffect(() => {
    if (fundId !== '') return;
    if (fundOptions.length === 0) return;
    setFundId(String(fundOptions[0].value));
  }, [fundOptions]);

  useEffect(() => {
    if (phase !== 'setup') return;
    if (!defaultOffsetAccountId) return;
    const nextId = Number(defaultOffsetAccountId);
    setParsedRows((prev) => prev.map((row) => ({ ...row, offset_account_id: nextId })));
  }, [defaultOffsetAccountId, phase]);

  const onOffsetChange = useCallback((index, offsetId) => {
    setParsedRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], offset_account_id: offsetId };
      return next;
    });
  }, []);

  const onBillLink = useCallback((index, billId) => {
    setParsedRows((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], bill_id: billId || undefined }
      return next
    })
  }, [])

  async function loadBillMatches(nextRows, nextBankAccountId) {
    setMatchLoadError('')
    setSuggestionsByRow({})

    const withdrawalRows = nextRows.filter((row) => row.type === 'withdrawal')
    if (withdrawalRows.length === 0) return

    try {
      const result = await getBillMatches.mutateAsync({
        bank_account_id: nextBankAccountId,
        rows: nextRows.map((row, idx) => ({
          row_index: idx + 1,
          date: row.date,
          amount: row.amount,
          type: row.type,
        })),
      })

      const grouped = {}
      ;(result.suggestions || []).forEach((suggestion) => {
        if (!grouped[suggestion.row_index]) grouped[suggestion.row_index] = []
        grouped[suggestion.row_index].push(suggestion)
      })
      setSuggestionsByRow(grouped)
    } catch (err) {
      setMatchLoadError(err.response?.data?.error || err.response?.data?.errors?.[0] || 'Failed to load bill match suggestions.')
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setParseError('');
    setErrors([]);
    setSkippedRows([]);
    setSuggestionsByRow({});
    setMatchLoadError('');
    try {
      const result = await parseStatementCsv(file);
      const nextOffsetId = defaultOffsetAccountId ? Number(defaultOffsetAccountId) : 0;
      setParsedRows(result.rows.map((row) => ({ ...row, offset_account_id: nextOffsetId })));
      setParseWarnings(result.warnings);
    } catch (err) {
      setParsedRows([]);
      setParseWarnings([]);
      setParseError(err.message || 'Failed to parse CSV.');
    } finally {
      setIsParsing(false);
    }
  }

  async function handlePreview() {
    const nextErrors = [];
    if (!bankAccountId) nextErrors.push('Bank account is required');
    if (!fundId) nextErrors.push('Fund is required');
    if (!parsedRows.length) nextErrors.push('Please upload a CSV with at least one transaction row');
    if (bankAccountId && defaultOffsetAccountId && Number(bankAccountId) === Number(defaultOffsetAccountId)) {
      nextErrors.push('Default offset account cannot be the same as the selected bank account');
    }
    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    setSkippedRows([]);
    const nextRows = defaultOffsetAccountId
      ? parsedRows.map((row) => ({ ...row, offset_account_id: Number(defaultOffsetAccountId) }))
      : parsedRows
    setParsedRows(nextRows);
    setPhase('preview');
    await loadBillMatches(nextRows, Number(bankAccountId));
  }

  async function handleImport(force) {
    const nextErrors = [];
    const nextBankAccountId = Number(bankAccountId);
    const nextFundId = Number(fundId);

    parsedRows.forEach((row, idx) => {
      const rowNumber = idx + 1;
      const offsetAccountId = Number(row.offset_account_id);
      if (!Number.isInteger(offsetAccountId) || offsetAccountId <= 0) {
        nextErrors.push(`Row ${rowNumber}: offset account is required`);
      } else if (offsetAccountId === nextBankAccountId) {
        nextErrors.push(`Row ${rowNumber}: offset account cannot be the same as the bank account`);
      }
    });

    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    try {
      const result = await importTransactions.mutateAsync({
        bank_account_id: nextBankAccountId,
        fund_id: nextFundId,
        rows: parsedRows.map((row) => ({
          date: row.date,
          description: row.description,
          reference_no: row.reference_no,
          amount: row.amount,
          type: row.type,
          offset_account_id: Number(row.offset_account_id),
          bill_id: row.bill_id,
        })),
        force,
      });

      if (result.skipped > 0 && !force) {
        setSkippedRows(result.skipped_rows || []);
        return;
      }

      addToast(
        `Imported ${result.imported} transactions. Adjust the date range to see them if they fall outside the current view.`,
        'success'
      );
      onClose();
    } catch (err) {
      const next = err.response?.data?.errors || [err.response?.data?.error || 'Import failed.'];
      setErrors(next);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {phase === 'setup' && (
        <>
          <Input label="CSV File" type="file" accept=".csv,text/csv,application/vnd.ms-excel" onChange={handleFileChange} />

          <div style={{ display: 'grid', gap: '0.8rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Combobox
              label="Bank Account"
              options={bankAccountOptions}
              value={bankAccountId ? Number(bankAccountId) : ''}
              onChange={(value) => setBankAccountId(String(value))}
              placeholder="Select bank account…"
            />
            <Combobox
              label="Default Offset Account"
              options={offsetAccountOptions}
              value={defaultOffsetAccountId ? Number(defaultOffsetAccountId) : ''}
              onChange={(value) => setDefaultOffsetAccountId(value === '' ? '' : String(value))}
              placeholder="Select default offset…"
            />
            <Combobox
              label="Fund"
              options={fundOptions}
              value={fundId ? Number(fundId) : ''}
              onChange={(value) => setFundId(String(value))}
              placeholder="Select fund…"
            />
          </div>

          <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            {isParsing ? 'Parsing CSV…' : parsedRows.length > 0 ? `${parsedRows.length} rows found` : 'No rows parsed yet'}
          </div>

          {parseError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem 1rem', color: '#b91c1c', fontSize: '0.82rem' }}>
              {parseError}
            </div>
          )}

          {parseWarnings.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              {parseWarnings.map((warning, idx) => (
                <div key={idx} style={{ color: '#92400e', fontSize: '0.82rem' }}>• {warning}</div>
              ))}
            </div>
          )}
        </>
      )}

      {phase === 'preview' && (
        <>
          {skippedRows.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#92400e', fontWeight: 600, marginBottom: '0.4rem' }}>
                {skippedRows.length} suspected duplicates skipped.
              </div>
              {skippedRows.map((row) => (
                <div key={`${row.row_index}-${row.date}-${row.amount}`} style={{ fontSize: '0.8rem', color: '#92400e' }}>
                  Row {row.row_index}: {formatDateOnlyForDisplay(row.date)} • {fmt(row.amount)} • {row.description}
                </div>
              ))}
            </div>
          )}

          {matchLoadError && (
            <div style={{ margin: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem 1rem', color: '#b91c1c', fontSize: '0.82rem' }}>
              {matchLoadError}
            </div>
          )}

          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'auto', maxHeight: '52vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1080px', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#6b7280', textAlign: 'left' }}>
                  <th style={{ padding: '0.55rem' }}>#</th>
                  <th style={{ padding: '0.55rem' }}>Date</th>
                  <th style={{ padding: '0.55rem' }}>Description</th>
                  <th style={{ padding: '0.55rem', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '0.55rem' }}>Type</th>
                  <th style={{ padding: '0.55rem' }}>Offset Account</th>
                  <th style={{ padding: '0.55rem' }}>Link to Bill</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row, idx) => (
                  <PreviewRow
                    key={`${row.date}-${row.description}-${idx}`}
                    row={row}
                    index={idx}
                    offsetOptions={offsetAccountOptions}
                    onOffsetChange={onOffsetChange}
                    suggestions={suggestionsByRow[idx + 1] || []}
                    onBillLink={onBillLink}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {errors.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem 1rem' }}>
          {errors.map((err, idx) => (
            <div key={idx} style={{ color: '#b91c1c', fontSize: '0.82rem' }}>• {err}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {phase === 'preview' && (
            <Button variant="secondary" onClick={() => setPhase('setup')}>
              Back
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {phase === 'setup' ? (
            <Button onClick={handlePreview} disabled={isParsing || !!parseError || !parsedRows.length || !bankAccountId || !fundId}>
              Preview
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => loadBillMatches(parsedRows, Number(bankAccountId))}
                isLoading={getBillMatches.isPending}
              >
                Refresh matches
              </Button>
              {skippedRows.length > 0 && (
                <Button variant="secondary" onClick={() => handleImport(true)} isLoading={importTransactions.isPending}>
                  Import all including duplicates
                </Button>
              )}
              <Button onClick={() => handleImport(false)} isLoading={importTransactions.isPending}>
                Import {parsedRows.length} transactions
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Transaction List Page ────────────────────────────────────────────────────
export default function Transactions() {
  const { addToast } = useToast();
  const [range,      setRange]      = useState(currentMonth());
  const [showForm,   setShowForm]   = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [expanded,   setExpanded]   = useState(null);
  const [editingTx,  setEditingTx]  = useState(null); // holds the full transaction object

  const { data, isLoading } = useTransactions({ from: range.from, to: range.to, limit: 100 });
  const deleteTx = useDeleteTransaction();
  const transactions = data?.transactions || [];

  function handleRowClick(row) {
    setExpanded((prev) => (prev === row.id ? null : row.id));
  }

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

  const COLUMNS = [
    { key: 'date', label: 'Date',
      render: (r) => formatDateOnlyForDisplay(r.date) },
    { key: 'description', label: 'Description', wrap: true },
    { key: 'reference_no', label: 'Ref',
      render: (r) => r.reference_no || <span style={{ color: '#d1d5db' }}>—</span> },
    { key: 'total_amount', label: 'Amount', align: 'right',
      render: (r) => <span style={{ fontWeight: 500 }}>{fmt(r.total_amount)}</span> },
    { key: 'actions', label: '', align: 'right',
      render: (r) => (
        <Button variant="ghost" size="sm" style={{ color: '#dc2626' }}
          onClick={(e) => handleDelete(e, r.id)}>
          Delete
        </Button>
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={() => setShowImport(true)}>Import CSV</Button>
          <Button onClick={() => setShowForm(true)}>+ New Transaction</Button>
        </div>
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
      </div>

      <Card>
        <Table
          columns={COLUMNS}
          rows={transactions}
          isLoading={isLoading}
          emptyText="No transactions in this date range."
          onRowClick={handleRowClick}
          expandedId={expanded}
          renderExpanded={(row) => (
            <TransactionDetail
              id={row.id}
              onEdit={setEditingTx}
            />
          )}
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

      <Modal isOpen={showImport} onClose={() => setShowImport(false)}
        title="Import Bank Statement" width="860px">
        {showImport && <ImportCsvModal onClose={() => setShowImport(false)} />}
      </Modal>
    </div>
  );
}

// ── Transaction Detail Panel ─────────────────────────────────────────────────
function TransactionDetail({ id, onEdit }) {
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let isMounted = true;

    import('../api/client').then(({ default: apiClient }) => {
      apiClient.get(`/transactions/${id}`).then(({ data }) => {
        if (!isMounted) return;
        setDetail(data.transaction);
      });
    });

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (!detail) return (
    <div style={{ padding: '0.75rem 1rem', background: '#f8fafc',
      fontSize: '0.8rem', color: '#6b7280' }}>
      Loading entries…
    </div>
  );

  return (
    <div style={{ padding: '0.75rem 1rem 1rem', background: '#f8fafc' }}>
      <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#6b7280' }}>
            <th style={{ textAlign: 'left',  padding: '0.25rem 0.5rem', fontWeight: 600 }}>Account</th>
            <th style={{ textAlign: 'left',  padding: '0.25rem 0.5rem', fontWeight: 600 }}>Fund</th>
            <th style={{ textAlign: 'left',  padding: '0.25rem 0.5rem', fontWeight: 600 }}>Contact</th>
            <th style={{ textAlign: 'left',  padding: '0.25rem 0.5rem', fontWeight: 600 }}>Description</th>
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
              <td style={{ padding: '0.3rem 0.5rem', color: '#6b7280' }}>{e.memo || '—'}</td>
              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#15803d' }}>
                {e.debit  > 0 ? fmt(e.debit)  : ''}
              </td>
              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#b91c1c' }}>
                {e.credit > 0 ? fmt(e.credit) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Detail panel action bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
        <Button variant="secondary" size="sm" onClick={() => onEdit(detail)}>
          Edit
        </Button>
      </div>
    </div>
  );
}
