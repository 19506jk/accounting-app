import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useImportTransactions, useGetBillMatches } from '../api/useTransactions';
import { useAccounts } from '../api/useAccounts';
import { useFunds } from '../api/useFunds';
import { useContacts } from '../api/useContacts';
import { useToast } from '../components/ui/Toast';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Combobox from '../components/ui/Combobox';
import Modal from '../components/ui/Modal';
import { parseStatementCsv } from '../utils/parseStatementCsv';
import { formatDateOnlyForDisplay } from '../utils/date';

const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
const toCents = (n) => Math.round((Number(n) || 0) * 100);

function SplitModal({
  isOpen,
  onClose,
  onSave,
  row,
  defaultFundId,
  offsetAccountOptions,
  fundOptions,
}) {
  const [lines, setLines] = useState([]);
  const [attempted, setAttempted] = useState(false);
  const { data: contacts = [] } = useContacts({ type: 'DONOR' });

  const donorOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...contacts.map((contact) => ({
      value: contact.id,
      label: contact.donor_id ? `${contact.donor_id} — ${contact.name}` : contact.name,
    })),
  ], [contacts]);

  useEffect(() => {
    if (!isOpen) return;
    if (row?.splits?.length > 0) {
      setLines(row.splits.map((split) => ({
        amount: String(split.amount),
        offset_account_id: split.offset_account_id,
        fund_id: split.fund_id,
        contact_id: split.contact_id ?? '',
        memo: split.memo || '',
      })));
    } else {
      setLines([{
        amount: '',
        offset_account_id: '',
        fund_id: defaultFundId || '',
        contact_id: '',
        memo: row?.description || '',
      }]);
    }
    setAttempted(false);
  }, [isOpen, row, defaultFundId]);

  if (!isOpen || !row) return null;

  const assignedCents = lines.reduce((sum, line) => sum + toCents(parseFloat(line.amount) || 0), 0);
  const remainingCents = toCents(row.amount) - assignedCents;
  const hasValidLines = lines.length > 0 && lines.every((line) => {
    const amount = Number(line.amount);
    return Number.isFinite(amount)
      && amount > 0
      && Number.isInteger(Number(line.offset_account_id))
      && Number(line.offset_account_id) > 0
      && Number.isInteger(Number(line.fund_id))
      && Number(line.fund_id) > 0;
  });
  const isBalanced = remainingCents === 0 && hasValidLines;
  const showDonor = row.type === 'deposit';

  const updateLine = (index, patch) => {
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const onAddLine = () => {
    setLines((prev) => [...prev, {
      amount: '',
      offset_account_id: '',
      fund_id: defaultFundId || '',
      contact_id: '',
      memo: row.description || '',
    }]);
  };

  const onDeleteLine = (index) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const onFillAmount = (index) => {
    const currentAmountCents = toCents(parseFloat(lines[index]?.amount) || 0);
    const nextAmountCents = remainingCents + currentAmountCents;
    updateLine(index, { amount: (nextAmountCents / 100).toFixed(2) });
  };

  const onSaveClick = () => {
    if (!isBalanced) {
      setAttempted(true);
      return;
    }
    onSave(lines.map((line) => ({
      amount: parseFloat(line.amount),
      offset_account_id: Number(line.offset_account_id),
      fund_id: Number(line.fund_id),
      contact_id: line.contact_id ? Number(line.contact_id) : null,
      memo: line.memo ? line.memo.trim() || null : null,
    })));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title='Split Transaction' width='820px'>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '1rem', color: '#475569', fontSize: '0.82rem' }}>
          <span>{formatDateOnlyForDisplay(row.date)}</span>
          <span>{row.description}</span>
          <span style={{ fontWeight: 600 }}>{fmt(row.amount)}</span>
        </div>

        <div style={{ maxHeight: '40vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.25rem' }}>
          {lines.map((line, idx) => (
            <div key={idx} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: showDonor ? '170px 1fr 160px 180px 1fr auto' : '170px 1fr 160px 1fr auto' }}>
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <Input
                  value={line.amount}
                  onChange={(e) => updateLine(idx, { amount: e.target.value })}
                  placeholder='Amount'
                />
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => onFillAmount(idx)}
                  title='Fill remaining amount'
                  disabled={remainingCents <= 0}
                >
                  ⚡
                </Button>
              </div>
              <Combobox
                options={offsetAccountOptions}
                value={line.offset_account_id}
                onChange={(value) => updateLine(idx, { offset_account_id: value })}
                placeholder='Offset account…'
              />
              <Combobox
                options={fundOptions}
                value={line.fund_id}
                onChange={(value) => updateLine(idx, { fund_id: value })}
                placeholder='Fund…'
              />
              {showDonor && (
                <Combobox
                  options={donorOptions}
                  value={line.contact_id}
                  onChange={(value) => updateLine(idx, { contact_id: value })}
                  placeholder='Donor…'
                />
              )}
              <Input
                value={line.memo}
                onChange={(e) => updateLine(idx, { memo: e.target.value })}
                placeholder='Memo (optional)'
              />
              <Button
                variant='ghost'
                size='sm'
                onClick={() => onDeleteLine(idx)}
                disabled={lines.length === 1}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button variant='secondary' size='sm' onClick={onAddLine}>Add Line</Button>
          <div style={{ color: remainingCents === 0 ? '#166534' : '#b91c1c', fontSize: '0.82rem', fontWeight: 600 }}>
            Remaining: {fmt(remainingCents / 100)}
          </div>
        </div>

        {attempted && !isBalanced && (
          <div style={{ color: '#b91c1c', fontSize: '0.8rem' }}>
            Split lines must be complete and sum exactly to the row amount.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Button variant='secondary' onClick={onClose}>Cancel</Button>
          <Button onClick={onSaveClick} disabled={!isBalanced}>Save Split</Button>
        </div>
      </div>
    </Modal>
  );
}

const PreviewRow = memo(function PreviewRow({
  row,
  index,
  offsetOptions,
  onOffsetChange,
  suggestions,
  onBillLink,
  onSplitOpen,
}) {
  const isWithdrawal = row.type === 'withdrawal'
  const hasSplits = row.splits?.length > 0
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
        {hasSplits ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', color: '#1d4ed8', fontWeight: 500 }}>
              Multiple ({row.splits.length} splits)
            </span>
            <Button variant='ghost' size='sm' onClick={() => onSplitOpen(index)}>Edit</Button>
            <Button variant='ghost' size='sm' onClick={() => onSplitOpen(index, true)}>Clear</Button>
          </div>
        ) : (
          <Combobox
            options={offsetOptions}
            value={row.offset_account_id || ''}
            onChange={(value) => onOffsetChange(index, Number(value))}
            placeholder='Offset account…'
          />
        )}
      </td>
      <td style={{ padding: '0.5rem', minWidth: '260px' }}>
        {hasSplits && <span style={{ color: '#9ca3af' }}>Unavailable for split rows</span>}
        {!hasSplits && !isWithdrawal && <span style={{ color: '#9ca3af' }}>—</span>}
        {!hasSplits && isWithdrawal && !isLinked && suggestions.length === 0 && (
          <span style={{ color: '#9ca3af' }}>No suggested bill</span>
        )}
        {!hasSplits && isWithdrawal && !isLinked && suggestions.length > 0 && (
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
        {!hasSplits && isLinked && (
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
      <td style={{ padding: '0.5rem' }}>
        {!row.bill_id && (
          <Button variant='ghost' size='sm' onClick={() => onSplitOpen(index)}>
            {hasSplits ? 'Edit Split' : 'Split'}
          </Button>
        )}
      </td>
    </tr>
  );
});

export default function ImportCsv() {
  const navigate = useNavigate();
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
  const [splitModalIndex, setSplitModalIndex] = useState(null);

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
    setParsedRows((prev) => prev.map((row) => (
      row.splits?.length > 0 ? row : { ...row, offset_account_id: nextId }
    )));
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
      next[index] = { ...next[index], bill_id: billId || undefined, splits: undefined }
      return next
    })
  }, [])

  const onSplitOpen = useCallback((index, clear = false) => {
    if (clear) {
      setParsedRows((prev) => {
        const next = [...prev]
        const fallbackOffsetId = defaultOffsetAccountId ? Number(defaultOffsetAccountId) : 0
        next[index] = {
          ...next[index],
          splits: undefined,
          offset_account_id: Number(next[index].offset_account_id) || fallbackOffsetId,
        }
        return next
      })
      return
    }
    setSplitModalIndex(index)
  }, [defaultOffsetAccountId])

  const onSplitClose = useCallback(() => setSplitModalIndex(null), [])

  const onSplitSave = useCallback((index, splits) => {
    setParsedRows((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        splits: splits.length > 0 ? splits : undefined,
        offset_account_id: splits.length > 0 ? undefined : Number(next[index].offset_account_id) || 0,
        bill_id: undefined,
      }
      return next
    })
    setSplitModalIndex(null)
  }, [])

  const handleBackToSetup = useCallback(() => {
    setErrors([]);
    setSkippedRows([]);
    setMatchLoadError('');
    setPhase('setup');
  }, []);

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
      ? parsedRows.map((row) => (
        row.splits?.length > 0 ? row : { ...row, offset_account_id: Number(defaultOffsetAccountId) }
      ))
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
      if (row.bill_id && row.splits?.length > 0) {
        nextErrors.push(`Row ${rowNumber}: cannot combine bill link and split lines`);
        return;
      }

      if (row.splits?.length > 0) {
        const splitTotalCents = row.splits.reduce((sum, split) => sum + toCents(split.amount), 0);
        const remainingCents = toCents(row.amount) - splitTotalCents;
        if (remainingCents !== 0) {
          nextErrors.push(`Row ${rowNumber}: split amounts do not sum to row total (remaining: ${fmt(remainingCents / 100)})`);
        }
      } else {
        const offsetAccountId = Number(row.offset_account_id);
        if (!Number.isInteger(offsetAccountId) || offsetAccountId <= 0) {
          nextErrors.push(`Row ${rowNumber}: offset account is required`);
        } else if (offsetAccountId === nextBankAccountId) {
          nextErrors.push(`Row ${rowNumber}: offset account cannot be the same as the bank account`);
        }
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
          offset_account_id: row.splits?.length > 0 ? undefined : Number(row.offset_account_id),
          bill_id: row.bill_id,
          splits: row.splits?.length > 0
            ? row.splits.map((split) => ({
              amount: split.amount,
              offset_account_id: Number(split.offset_account_id),
              fund_id: Number(split.fund_id),
              contact_id: split.contact_id ? Number(split.contact_id) : null,
              memo: split.memo || null,
            }))
            : undefined,
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
      navigate('/transactions');
    } catch (err) {
      const next = err.response?.data?.errors || [err.response?.data?.error || 'Import failed.'];
      setErrors(next);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Import Bank Statement
        </h1>
      </div>

      <Card>
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

              {splitModalIndex !== null && (
                <SplitModal
                  isOpen={true}
                  onClose={onSplitClose}
                  onSave={(splits) => onSplitSave(splitModalIndex, splits)}
                  row={parsedRows[splitModalIndex]}
                  defaultFundId={Number(fundId)}
                  offsetAccountOptions={offsetAccountOptions}
                  fundOptions={fundOptions}
                />
              )}

              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'auto', maxHeight: '65vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1180px', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#6b7280', textAlign: 'left' }}>
                      <th style={{ padding: '0.55rem' }}>#</th>
                      <th style={{ padding: '0.55rem' }}>Date</th>
                      <th style={{ padding: '0.55rem' }}>Description</th>
                      <th style={{ padding: '0.55rem', textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '0.55rem' }}>Type</th>
                      <th style={{ padding: '0.55rem' }}>Offset Account</th>
                      <th style={{ padding: '0.55rem' }}>Link to Bill</th>
                      <th style={{ padding: '0.55rem' }}>Actions</th>
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
                        onSplitOpen={onSplitOpen}
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
                <Button variant="secondary" onClick={handleBackToSetup}>
                  Back
                </Button>
              )}
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
      </Card>
    </div>
  );
}
