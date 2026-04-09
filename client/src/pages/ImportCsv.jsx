import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useImportTransactions, useGetBillMatches } from '../api/useTransactions';
import { useAccounts } from '../api/useAccounts';
import { useFunds } from '../api/useFunds';
import { useToast } from '../components/ui/Toast';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Combobox from '../components/ui/Combobox';
import { parseStatementCsv } from '../utils/parseStatementCsv';
import { formatDateOnlyForDisplay } from '../utils/date';

const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });

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

              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'auto', maxHeight: '65vh' }}>
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
