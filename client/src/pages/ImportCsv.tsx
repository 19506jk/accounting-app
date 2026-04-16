import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAccounts } from '../api/useAccounts';
import { useContacts } from '../api/useContacts';
import { useFunds } from '../api/useFunds';
import { useSettings } from '../api/useSettings';
import { useGetBillMatches, useImportTransactions } from '../api/useTransactions';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { useToast } from '../components/ui/Toast';
import { formatDateOnlyForDisplay } from '../utils/date';
import { getErrorMessage } from '../utils/errors';
import { parseStatementCsv } from '../utils/parseStatementCsv';
import ImportPreviewTable from './importCsv/ImportPreviewTable';
import ImportSetupPanel from './importCsv/ImportSetupPanel';
import SplitTransactionModal from './importCsv/SplitTransactionModal';
import { dec, enrichParsedRows, fmt, groupBillSuggestions } from './importCsv/importCsvHelpers';
import type React from 'react';
import type {
  BillMatchSuggestion,
  ImportTransactionsInput,
  SkippedImportRow,
} from '@shared/contracts';
import type { SelectOption } from '../components/ui/types';
import type { ImportPhase, ParsedImportRow, SplitSavePayload, TransactionRowType } from './importCsv/importCsvTypes';

function validateRowsForImport(
  rows: ParsedImportRow[],
  selectedRows: Set<number>,
  bankAccountId: number
) {
  const nextErrors: string[] = [];

  rows.forEach((row, idx) => {
    if (!selectedRows.has(idx)) return;
    const rowNumber = idx + 1;
    const splits = row.splits ?? [];
    if (row.bill_id && splits.length > 0) {
      nextErrors.push(`Row ${rowNumber}: cannot combine bill link and split lines`);
      return;
    }

    if (splits.length > 0) {
      const splitTotal = splits.reduce((sum, split) => (
        sum.plus(dec(split.amount).toDecimalPlaces(2))
      ), dec(0)).toDecimalPlaces(2);
      const rowAmount = dec(row.amount).toDecimalPlaces(2);
      const remaining = rowAmount.minus(splitTotal).toDecimalPlaces(2);
      if (!splitTotal.equals(rowAmount)) {
        nextErrors.push(`Row ${rowNumber}: split amounts do not sum to row total (remaining: ${fmt(remaining.toFixed(2))})`);
      }

      if (row.type === 'withdrawal') {
        const normalizedPayeeId = Number(row.payee_id);
        if (!Number.isInteger(normalizedPayeeId) || normalizedPayeeId <= 0) {
          nextErrors.push(`Row ${rowNumber}: payee is required for withdrawal split rows`);
        }
      }
    } else {
      const offsetAccountId = Number(row.offset_account_id);
      if (!Number.isInteger(offsetAccountId) || offsetAccountId <= 0) {
        nextErrors.push(`Row ${rowNumber}: offset account is required`);
      } else if (offsetAccountId === bankAccountId) {
        nextErrors.push(`Row ${rowNumber}: offset account cannot be the same as the bank account`);
      }
    }
  });

  return nextErrors;
}

function buildImportPayload(
  rows: ParsedImportRow[],
  selectedRows: Set<number>,
  bankAccountId: number,
  fundId: number,
  force: boolean
): ImportTransactionsInput {
  return {
    bank_account_id: bankAccountId,
    fund_id: fundId,
    rows: rows
      .filter((_, i) => selectedRows.has(i))
      .map((row) => {
        const splits = row.splits ?? [];
        return {
          date: row.date,
          description: row.description,
          reference_no: row.reference_no,
          amount: row.amount,
          type: row.type,
          offset_account_id: splits.length > 0 ? undefined : Number(row.offset_account_id),
          payee_id: row.payee_id ? Number(row.payee_id) : undefined,
          contact_id: row.contact_id ? Number(row.contact_id) : undefined,
          bill_id: row.bill_id,
          splits: splits.length > 0
            ? splits.map((split) => ({
              amount: split.amount,
              fund_id: Number(split.fund_id),
              ...(row.type === 'withdrawal'
                ? {
                  expense_account_id: Number(split.expense_account_id),
                  tax_rate_id: split.tax_rate_id ? Number(split.tax_rate_id) : null,
                  pre_tax_amount: Number(split.pre_tax_amount),
                  rounding_adjustment: Number(split.rounding_adjustment || 0),
                  description: split.description || null,
                }
                : {
                  offset_account_id: Number(split.offset_account_id),
                  contact_id: split.contact_id ? Number(split.contact_id) : null,
                  memo: split.memo || null,
                }),
            }))
            : undefined,
        };
      }),
    force,
  };
}

export default function ImportCsv() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { data: accounts } = useAccounts();
  const { data: funds } = useFunds();
  const { data: donorContacts = [] } = useContacts({ type: 'DONOR' });
  const { data: payeeContacts = [] } = useContacts({ type: 'PAYEE' });
  const importTransactions = useImportTransactions();
  const getBillMatches = useGetBillMatches();
  const { data: settings } = useSettings();

  const [phase, setPhase] = useState<ImportPhase>('setup');
  const [bankAccountId, setBankAccountId] = useState('');
  const [fundId, setFundId] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedImportRow[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [parseError, setParseError] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [skippedRows, setSkippedRows] = useState<SkippedImportRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [suggestionsByRow, setSuggestionsByRow] = useState<Record<number, BillMatchSuggestion[]>>({});
  const [matchLoadError, setMatchLoadError] = useState('');
  const [splitModalIndex, setSplitModalIndex] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  const activeAccounts = useMemo(
    () => (accounts || []).filter((a) => a.is_active),
    [accounts]
  );

  const bankAccountOptions = useMemo<SelectOption[]>(
    () => activeAccounts
      .filter((a) => a.type === 'ASSET')
      .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [activeAccounts]
  );

  const offsetAccountOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'None' },
      ...activeAccounts
        .filter((a) => a.id !== Number(bankAccountId || 0))
        .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    ],
    [activeAccounts, bankAccountId]
  );

  const defaultEtransferOffsetId = useMemo(() => {
    const raw = settings?.etransfer_deposit_offset_account_id;
    return raw ? Number(raw) : 0;
  }, [settings]);

  const fundOptions = useMemo<SelectOption[]>(
    () => (funds || []).filter((f) => f.is_active).map((f) => ({ value: f.id, label: f.name })),
    [funds]
  );

  const expenseAccountOptions = useMemo<SelectOption[]>(
    () => activeAccounts
      .filter((a) => a.type === 'EXPENSE')
      .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [activeAccounts]
  );

  const activeExpenseAccountIds = useMemo(
    () => activeAccounts.filter((a) => a.type === 'EXPENSE').map((a) => a.id),
    [activeAccounts]
  );

  const donorOptions = useMemo<SelectOption[]>(() => [
    { value: '', label: 'None' },
    ...donorContacts
      .filter((contact) => contact.is_active)
      .map((contact) => ({
        value: contact.id,
        label: contact.donor_id ? `${contact.donor_id} — ${contact.name}` : contact.name,
      })),
  ], [donorContacts]);

  const payeeOptions = useMemo<SelectOption[]>(() => [
    { value: '', label: 'None' },
    ...payeeContacts
      .filter((contact) => contact.is_active)
      .map((contact) => ({ value: contact.id, label: contact.name })),
  ], [payeeContacts]);

  useEffect(() => {
    if (bankAccountId !== '') return;
    const defaultBankAccount = bankAccountOptions[0];
    if (!defaultBankAccount) return;
    setBankAccountId(String(defaultBankAccount.value));
  }, [bankAccountOptions, bankAccountId]);

  useEffect(() => {
    if (fundId !== '') return;
    const defaultFund = fundOptions[0];
    if (!defaultFund) return;
    setFundId(String(defaultFund.value));
  }, [fundOptions, fundId]);

  const onOffsetChange = useCallback((index: number, offsetId: number) => {
    setParsedRows((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      next[index] = { ...current, offset_account_id: offsetId };
      return next;
    });
  }, []);

  const onContactChange = useCallback((index: number, contactId: number | undefined, type: TransactionRowType) => {
    setParsedRows((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      if (type === 'withdrawal') {
        next[index] = { ...current, payee_id: contactId || undefined };
      } else {
        next[index] = { ...current, contact_id: contactId || undefined };
      }
      return next;
    });
  }, []);

  const onReferenceChange = useCallback((index: number, referenceNo: string) => {
    setParsedRows((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      next[index] = { ...current, reference_no: referenceNo };
      return next;
    });
  }, []);

  const onBillLink = useCallback((index: number, billId: number | null) => {
    setParsedRows((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      next[index] = {
        ...current,
        bill_id: billId || undefined,
        splits: undefined,
        payee_id: undefined,
        contact_id: undefined,
      };
      return next;
    });
  }, []);

  const onSplitOpen = useCallback((index: number, clear = false) => {
    if (clear) {
      setParsedRows((prev) => {
        const next = [...prev];
        const current = next[index];
        if (!current) return prev;
        next[index] = {
          ...current,
          splits: undefined,
          offset_account_id: Number(current.offset_account_id) || 0,
          payee_id: undefined,
          contact_id: undefined,
        };
        return next;
      });
      return;
    }
    setSplitModalIndex(index);
  }, []);

  const onSplitClose = useCallback(() => setSplitModalIndex(null), []);

  const onSplitSave = useCallback((index: number, payload: SplitSavePayload) => {
    setParsedRows((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      const splitPayload = Array.isArray(payload) ? { splits: payload } : payload;
      const normalizedSplits = splitPayload.splits || [];
      next[index] = {
        ...current,
        splits: normalizedSplits.length > 0 ? normalizedSplits : undefined,
        payee_id: 'payee_id' in splitPayload ? splitPayload.payee_id || undefined : undefined,
        contact_id: normalizedSplits.length > 0 ? undefined : current.contact_id,
        offset_account_id: normalizedSplits.length > 0 ? undefined : Number(current.offset_account_id) || 0,
        bill_id: undefined,
      };
      return next;
    });
    setSplitModalIndex(null);
  }, []);

  const handleBackToSetup = useCallback(() => {
    setErrors([]);
    setSkippedRows([]);
    setMatchLoadError('');
    setSelectedRows(new Set<number>());
    setPhase('setup');
  }, []);

  const onToggleRow = useCallback((index: number) => {
    setSelectedRows((prev) => {
      const next = new Set<number>(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  async function loadBillMatches(nextRows: ParsedImportRow[], nextBankAccountId: number) {
    setMatchLoadError('');
    setSuggestionsByRow({});

    const withdrawalRows = nextRows.filter((row) => row.type === 'withdrawal');
    if (withdrawalRows.length === 0) return;

    try {
      const result = await getBillMatches.mutateAsync({
        bank_account_id: nextBankAccountId,
        rows: nextRows.map((row, idx) => ({
          row_index: idx + 1,
          date: row.date,
          amount: row.amount,
          type: row.type,
        })),
      });

      setSuggestionsByRow(groupBillSuggestions(result.suggestions || []));
    } catch (err) {
      setMatchLoadError(getErrorMessage(err, 'Failed to load bill match suggestions.'));
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setParseError('');
    setErrors([]);
    setSkippedRows([]);
    setSuggestionsByRow({});
    setMatchLoadError('');
    setSelectedRows(new Set());
    try {
      const result = await parseStatementCsv(file);
      setParsedRows(enrichParsedRows(result.rows, result.metadata, donorContacts, defaultEtransferOffsetId));
      setParseWarnings(result.warnings);
    } catch (err) {
      setParsedRows([]);
      setParseWarnings([]);
      setParseError(getErrorMessage(err, 'Failed to parse CSV.'));
    } finally {
      setIsParsing(false);
    }
  }

  async function handlePreview() {
    const nextErrors: string[] = [];
    if (!bankAccountId) nextErrors.push('Bank account is required');
    if (!fundId) nextErrors.push('Fund is required');
    if (!parsedRows.length) nextErrors.push('Please upload a CSV with at least one transaction row');
    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    setSkippedRows([]);
    setSelectedRows(new Set<number>(parsedRows.map((_, i) => i)));
    setPhase('preview');
    await loadBillMatches(parsedRows, Number(bankAccountId));
  }

  async function handleImport(force: boolean) {
    if (selectedRows.size === 0) {
      setErrors(['Please select at least one row to import']);
      return;
    }

    const nextBankAccountId = Number(bankAccountId);
    const nextFundId = Number(fundId);
    const nextErrors = validateRowsForImport(parsedRows, selectedRows, nextBankAccountId);

    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    try {
      const payload = buildImportPayload(parsedRows, selectedRows, nextBankAccountId, nextFundId, force);
      const result = await importTransactions.mutateAsync(payload);

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
      setErrors([getErrorMessage(err, 'Import failed.')]);
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
            <ImportSetupPanel
              bankAccountId={bankAccountId}
              fundId={fundId}
              bankAccountOptions={bankAccountOptions}
              fundOptions={fundOptions}
              isParsing={isParsing}
              parsedRowCount={parsedRows.length}
              parseError={parseError}
              parseWarnings={parseWarnings}
              onFileChange={handleFileChange}
              onBankAccountChange={setBankAccountId}
              onFundChange={setFundId}
            />
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
                <SplitTransactionModal
                  isOpen={true}
                  onClose={onSplitClose}
                  onSave={(payload) => onSplitSave(splitModalIndex, payload)}
                  row={parsedRows[splitModalIndex]}
                  defaultFundId={Number(fundId)}
                  offsetAccountOptions={offsetAccountOptions}
                  fundOptions={fundOptions}
                  donorOptions={donorOptions}
                  payeeOptions={payeeOptions}
                  expenseAccountOptions={expenseAccountOptions}
                  activeExpenseAccountIds={activeExpenseAccountIds}
                />
              )}

              <ImportPreviewTable
                rows={parsedRows}
                selectedRows={selectedRows}
                suggestionsByRow={suggestionsByRow}
                offsetOptions={offsetAccountOptions}
                donorOptions={donorOptions}
                payeeOptions={payeeOptions}
                onSelectedRowsChange={setSelectedRows}
                onToggleRow={onToggleRow}
                onOffsetChange={onOffsetChange}
                onReferenceChange={onReferenceChange}
                onContactChange={onContactChange}
                onBillLink={onBillLink}
                onSplitOpen={onSplitOpen}
              />
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
                    <Button variant="secondary" onClick={() => handleImport(true)} isLoading={importTransactions.isPending} disabled={selectedRows.size === 0}>
                      Import all including duplicates
                    </Button>
                  )}
                  <Button onClick={() => handleImport(false)} isLoading={importTransactions.isPending} disabled={selectedRows.size === 0}>
                    Import {selectedRows.size} transaction(s)
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
