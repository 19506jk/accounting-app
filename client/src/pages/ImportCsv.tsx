import { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import Decimal from 'decimal.js';
import { useNavigate } from 'react-router-dom';
import { useImportTransactions, useGetBillMatches } from '../api/useTransactions';
import { useAccounts } from '../api/useAccounts';
import { useFunds } from '../api/useFunds';
import { useContacts } from '../api/useContacts';
import { useTaxRates } from '../api/useTaxRates';
import { useSettings } from '../api/useSettings';
import { useToast } from '../components/ui/Toast';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Combobox from '../components/ui/Combobox';
import Modal from '../components/ui/Modal';
import { parseStatementCsv } from '../utils/parseStatementCsv';
import { formatDateOnlyForDisplay } from '../utils/date';
import { getErrorMessage } from '../utils/errors';
import type React from 'react';
import type {
  BillMatchSuggestion,
  ContactSummary,
  ImportTransactionRow,
  ImportTransactionsInput,
  SkippedImportRow,
  TaxRateSummary,
  TransactionSplit,
} from '@shared/contracts';
import type { OptionValue, SelectOption } from '../components/ui/types';

const fmt = (n: Decimal.Value | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
const MAX_ROUNDING_ADJUSTMENT = new Decimal('0.10');
// Align with server DB column: migrations/004_transactions.js -> t.string('reference_no')
const REFERENCE_NO_MAX_LENGTH = 255;
const PREVIEW_CONTROL_LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#64748b',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};
const PREVIEW_CONTROL_GROUP_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  minWidth: '170px',
  flex: '1 1 220px',
};
const SR_ONLY_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
type ImportPhase = 'setup' | 'preview';
type TransactionRowType = ImportTransactionRow['type'];

interface StatementRowMetadata {
  description_1?: string;
  sender?: string;
  from?: string;
}

interface ParsedImportRow extends Omit<ImportTransactionRow, 'offset_account_id' | 'payee_id' | 'contact_id' | 'bill_id' | 'splits'> {
  offset_account_id?: number;
  payee_id?: number;
  contact_id?: number;
  bill_id?: number;
  splits?: TransactionSplit[];
}

interface DepositSplitModalLine {
  type: 'deposit';
  amount: string;
  offset_account_id: OptionValue | '';
  fund_id: OptionValue | '';
  contact_id: OptionValue | '';
  memo: string;
}

interface WithdrawalSplitModalLine {
  type: 'withdrawal';
  amount: string;
  expense_account_id: OptionValue | '';
  tax_rate_id: string;
  pre_tax_amount: string;
  rounding_adjustment: string;
  description: string;
  fund_id: OptionValue | '';
  is_legacy_mapped: boolean;
}

type SplitModalLine = DepositSplitModalLine | WithdrawalSplitModalLine;

interface WithdrawalSplitSavePayload {
  payee_id: number;
  splits: TransactionSplit[];
}

type SplitSavePayload = TransactionSplit[] | WithdrawalSplitSavePayload;

interface SplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: SplitSavePayload) => void;
  row: ParsedImportRow | undefined;
  defaultFundId: number;
  offsetAccountOptions: SelectOption[];
  fundOptions: SelectOption[];
  expenseAccountOptions: SelectOption[];
  activeExpenseAccountIds: number[];
}

interface PreviewRowProps {
  row: ParsedImportRow;
  index: number;
  isSelected: boolean;
  onToggle: () => void;
  offsetOptions: SelectOption[];
  donorOptions: SelectOption[];
  payeeOptions: SelectOption[];
  onOffsetChange: (index: number, offsetId: number) => void;
  onReferenceChange: (index: number, referenceNo: string) => void;
  onContactChange: (index: number, contactId: number | undefined, type: TransactionRowType) => void;
  suggestions: BillMatchSuggestion[];
  onBillLink: (index: number, billId: number | null) => void;
  onSplitOpen: (index: number, clear?: boolean) => void;
}

interface WithdrawalLineTotal {
  preTax: Decimal;
  rounding: Decimal;
  tax: Decimal;
  gross: Decimal;
  taxRate: TaxRateSummary | null;
}

const normalize = (s: unknown) => String(s ?? '').trim().toLowerCase();
const ETRANSFER_TOKENS = ['e-transfer', 'etransfer', 'interac e-transfer'];
const isEtransferDeposit = (row: ImportTransactionRow, metadata?: StatementRowMetadata) => {
  if (row.type !== 'deposit') return false;
  const desc = normalize(metadata?.description_1);
  return ETRANSFER_TOKENS.some((token) => desc.includes(token));
};
const dec = (value: Decimal.Value | null | undefined) => {
  try {
    return new Decimal(value || 0);
  } catch {
    return new Decimal(0);
  }
};

function SplitModal({
  isOpen,
  onClose,
  onSave,
  row,
  defaultFundId,
  offsetAccountOptions,
  fundOptions,
  expenseAccountOptions,
  activeExpenseAccountIds,
}: SplitModalProps) {
  const [lines, setLines] = useState<SplitModalLine[]>([]);
  const [payeeId, setPayeeId] = useState('');
  const [attempted, setAttempted] = useState(false);
  const { data: donorContacts = [] } = useContacts({ type: 'DONOR' });
  const { data: payeeContacts = [] } = useContacts({ type: 'PAYEE' });
  const taxRatesQuery = useTaxRates({ activeOnly: true });
  const taxRates = taxRatesQuery.data || [];
  const isTaxRatesLoading = taxRatesQuery.isPending;
  const isWithdrawal = row?.type === 'withdrawal';

  const donorOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...donorContacts
      .filter((contact) => contact.is_active)
      .map((contact) => ({
      value: contact.id,
      label: contact.donor_id ? `${contact.donor_id} — ${contact.name}` : contact.name,
      })),
  ], [donorContacts]);

  const payeeOptions = useMemo(() => ([
    { value: '', label: 'None' },
    ...payeeContacts
      .filter((contact) => contact.is_active)
      .map((contact) => ({ value: String(contact.id), label: contact.name })),
  ]), [payeeContacts]);

  const taxRateOptions = useMemo(() => ([
    { value: '', label: 'Exempt' },
    ...taxRates.map((taxRate) => ({
      value: String(taxRate.id),
      label: `${taxRate.name} (${(taxRate.rate * 100).toFixed(2)}%)`,
    })),
  ]), [taxRates]);

  const taxRateMap = useMemo<Record<string, TaxRateSummary>>(
    () => Object.fromEntries(taxRates.map((taxRate) => [String(taxRate.id), taxRate])),
    [taxRates]
  );

  useEffect(() => {
    if (!isOpen) return;

    if (isWithdrawal) {
      let nextPayee = row?.payee_id ? String(row.payee_id) : '';
      const existingSplits = row?.splits ?? [];
      if (existingSplits.length > 0) {
        setLines(existingSplits.map((split) => {
          const isLegacyMapped = split.expense_account_id === undefined && split.offset_account_id !== undefined;
          if (!nextPayee && split.contact_id) nextPayee = String(split.contact_id);
          return {
            type: 'withdrawal',
            amount: String(split.amount ?? ''),
            expense_account_id: split.expense_account_id ?? split.offset_account_id ?? '',
            tax_rate_id: split.tax_rate_id ? String(split.tax_rate_id) : '',
            pre_tax_amount: String(split.pre_tax_amount ?? split.amount ?? ''),
            rounding_adjustment: String(split.rounding_adjustment ?? ''),
            description: split.description ?? split.memo ?? row?.description ?? '',
            fund_id: split.fund_id || defaultFundId || '',
            is_legacy_mapped: isLegacyMapped,
          };
        }));
      } else {
        setLines([{
          type: 'withdrawal',
          amount: '',
          expense_account_id: '',
          tax_rate_id: '',
          pre_tax_amount: '',
          rounding_adjustment: '',
          description: row?.description || '',
          fund_id: defaultFundId || '',
          is_legacy_mapped: false,
        }]);
      }
      setPayeeId(nextPayee);
      setAttempted(false);
      return;
    }

    const existingSplits = row?.splits ?? [];
    if (existingSplits.length > 0) {
      setLines(existingSplits.map((split) => ({
        type: 'deposit',
        amount: String(split.amount),
        offset_account_id: split.offset_account_id ?? '',
        fund_id: split.fund_id,
        contact_id: split.contact_id ?? '',
        memo: split.memo || '',
      })));
    } else {
      setLines([{
        type: 'deposit',
        amount: '',
        offset_account_id: '',
        fund_id: defaultFundId || '',
        contact_id: '',
        memo: row?.description || '',
      }]);
    }
    setPayeeId('');
    setAttempted(false);
  }, [isOpen, row, defaultFundId, isWithdrawal]);

  if (!isOpen || !row) return null;

  const rowAmount = dec(row.amount).toDecimalPlaces(2);
  const withdrawalLines = lines.filter((line): line is WithdrawalSplitModalLine => line.type === 'withdrawal');
  const depositLines = lines.filter((line): line is DepositSplitModalLine => line.type === 'deposit');
  const withdrawalLineTotals = lines.map((line): WithdrawalLineTotal => {
    if (line.type !== 'withdrawal') {
      return { preTax: dec(0), rounding: dec(0), tax: dec(0), gross: dec(0), taxRate: null };
    }
    const preTax = dec(line.pre_tax_amount).toDecimalPlaces(2);
    const rounding = dec(line.rounding_adjustment || 0).toDecimalPlaces(2);
    const taxRate = line.tax_rate_id ? taxRateMap[line.tax_rate_id] ?? null : null;
    const tax = taxRate ? preTax.times(dec(taxRate.rate)).toDecimalPlaces(2) : dec(0);
    const gross = preTax.plus(tax).plus(rounding).toDecimalPlaces(2);
    return { preTax, rounding, tax, gross, taxRate };
  });
  const assignedAmount = lines.reduce((sum, line, idx) => (
    sum.plus(isWithdrawal ? (withdrawalLineTotals[idx]?.gross ?? dec(0)) : dec(line.amount).toDecimalPlaces(2))
  ), dec(0)).toDecimalPlaces(2);
  const remainingAmount = rowAmount.minus(assignedAmount).toDecimalPlaces(2);
  const hasValidDepositLines = lines.length > 0 && lines.every((line) => {
    if (line.type !== 'deposit') return false;
    const amount = Number(line.amount);
    return Number.isFinite(amount)
      && amount > 0
      && Number.isInteger(Number(line.offset_account_id))
      && Number(line.offset_account_id) > 0
      && Number.isInteger(Number(line.fund_id))
      && Number(line.fund_id) > 0;
  });
  const hasValidWithdrawalLines = lines.length > 0 && lines.every((line, idx) => {
    if (line.type !== 'withdrawal') return false;
    const totals = withdrawalLineTotals[idx];
    if (!totals) return false;
    if (!Number.isInteger(Number(line.expense_account_id)) || Number(line.expense_account_id) <= 0) return false;
    if (!Number.isInteger(Number(line.fund_id)) || Number(line.fund_id) <= 0) return false;
    if (!line.pre_tax_amount || totals.preTax.lte(0)) return false;
    if (totals.preTax.decimalPlaces() > 2) return false;
    if (totals.rounding.decimalPlaces() > 2) return false;
    if (totals.rounding.abs().gt(MAX_ROUNDING_ADJUSTMENT)) return false;
    if (line.tax_rate_id && !totals.taxRate) return false;
    if (totals.taxRate && !totals.taxRate.recoverable_account_id) return false;
    return true;
  });
  const hasValidPayee = Number.isInteger(Number(payeeId)) && Number(payeeId) > 0;
  const isBalanced = isWithdrawal
    ? hasValidPayee && hasValidWithdrawalLines && assignedAmount.equals(rowAmount)
    : hasValidDepositLines && assignedAmount.equals(rowAmount);
  const showDonor = row.type === 'deposit';
  const splitGridTemplateColumns = showDonor
    ? '150px 2fr 150px 160px 1fr auto'
    : '150px 2fr 150px 1fr auto';
  const withdrawalGridTemplateColumns = 'minmax(190px, 1.35fr) minmax(140px, 0.95fr) 110px 110px minmax(180px, 1.1fr) 110px 120px 46px';

  const legacyWarnings = isWithdrawal
    ? lines
      .map((line, idx) => ({ line, idx }))
      .filter(({ line }) => (
        line.type === 'withdrawal'
        && line.is_legacy_mapped
        && Number(line.expense_account_id) > 0
        && !activeExpenseAccountIds.includes(Number(line.expense_account_id))
      ))
      .map(({ idx }) => idx + 1)
    : [];

  const updateDepositLine = (index: number, patch: Partial<Omit<DepositSplitModalLine, 'type'>>) => {
    setLines((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current || current.type !== 'deposit') return prev;
      next[index] = { ...current, ...patch };
      return next;
    });
  };

  const updateWithdrawalLine = (index: number, patch: Partial<Omit<WithdrawalSplitModalLine, 'type'>>) => {
    setLines((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current || current.type !== 'withdrawal') return prev;
      next[index] = { ...current, ...patch };
      return next;
    });
  };

  const onAddLine = () => {
    if (isWithdrawal) {
      setLines((prev) => [...prev, {
        type: 'withdrawal',
        amount: '',
        expense_account_id: '',
        tax_rate_id: '',
        pre_tax_amount: '',
        rounding_adjustment: '',
        description: row.description || '',
        fund_id: defaultFundId || '',
        is_legacy_mapped: false,
      }]);
      return;
    }

    setLines((prev) => [...prev, {
      type: 'deposit',
      amount: '',
      offset_account_id: '',
      fund_id: defaultFundId || '',
      contact_id: '',
      memo: row.description || '',
    }]);
  };

  const onDeleteLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const onFillAmount = (index: number) => {
    const currentAmount = dec(lines[index]?.amount).toDecimalPlaces(2);
    const nextAmount = remainingAmount.plus(currentAmount).toDecimalPlaces(2);
    updateDepositLine(index, { amount: nextAmount.toFixed(2) });
  };

  const onSaveClick = () => {
    if (!isBalanced) {
      setAttempted(true);
      return;
    }

    if (isWithdrawal) {
      onSave({
        payee_id: Number(payeeId),
        splits: withdrawalLines.map((line, idx) => {
          const totals = withdrawalLineTotals[idx] ?? {
            preTax: dec(0),
            rounding: dec(0),
            tax: dec(0),
            gross: dec(0),
            taxRate: null,
          };
          return {
            amount: parseFloat(totals.gross.toFixed(2)),
            fund_id: Number(line.fund_id),
            expense_account_id: Number(line.expense_account_id),
            tax_rate_id: line.tax_rate_id ? Number(line.tax_rate_id) : null,
            pre_tax_amount: parseFloat(totals.preTax.toFixed(2)),
            rounding_adjustment: parseFloat(totals.rounding.toFixed(2)),
            description: line.description ? line.description.trim() || null : null,
          };
        }),
      });
      return;
    }

    onSave(depositLines.map((line) => ({
      amount: parseFloat(line.amount),
      offset_account_id: Number(line.offset_account_id),
      fund_id: Number(line.fund_id),
      contact_id: line.contact_id ? Number(line.contact_id) : null,
      memo: line.memo ? line.memo.trim() || null : null,
    })));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title='Split Transaction' width='1320px'>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '1rem', color: '#475569', fontSize: '0.95rem', marginBottom: '0.4rem' }}>
          <span>{formatDateOnlyForDisplay(row.date)}</span>
          <span>{row.description}</span>
          <span style={{ fontWeight: 600 }}>{fmt(row.amount)}</span>
        </div>

        {isWithdrawal && (
          <div style={{ maxWidth: '360px' }}>
            <Combobox
              label='Payee'
              required
              options={payeeOptions}
              value={payeeId}
              onChange={(value) => setPayeeId(String(value || ''))}
              placeholder='Select payee...'
            />
          </div>
        )}

        <div style={{ maxHeight: '40vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.25rem' }}>
          {isWithdrawal ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gap: '0.5rem',
                  gridTemplateColumns: withdrawalGridTemplateColumns,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  padding: '0 0.25rem',
                }}
              >
                <span>Expense Account</span>
                <span>Tax Type</span>
                <span style={{ textAlign: 'right' }}>Pre-tax</span>
                <span style={{ textAlign: 'right' }}>Rounding</span>
                <span>Description</span>
                <span>Fund</span>
                <span style={{ textAlign: 'right' }}>Gross</span>
                <span />
              </div>
              {withdrawalLines.map((line, idx) => (
                <div key={idx} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: withdrawalGridTemplateColumns, alignItems: 'center' }}>
                  <Combobox
                    options={expenseAccountOptions}
                    value={line.expense_account_id}
                    onChange={(value) => updateWithdrawalLine(idx, { expense_account_id: value })}
                    placeholder='Expense account…'
                  />
                  <Combobox
                    options={taxRateOptions}
                    value={line.tax_rate_id}
                    onChange={(value) => updateWithdrawalLine(idx, { tax_rate_id: String(value) })}
                    placeholder='Tax type…'
                  />
                  <Input
                    type='number'
                    min='0'
                    step='0.01'
                    value={line.pre_tax_amount}
                    onChange={(e) => updateWithdrawalLine(idx, { pre_tax_amount: e.target.value })}
                    placeholder='0.00'
                    style={{ textAlign: 'right' }}
                  />
                  <Input
                    type='number'
                    min={MAX_ROUNDING_ADJUSTMENT.times(-1).toFixed(2)}
                    max={MAX_ROUNDING_ADJUSTMENT.toFixed(2)}
                    step='0.01'
                    value={line.rounding_adjustment}
                    onChange={(e) => updateWithdrawalLine(idx, { rounding_adjustment: e.target.value })}
                    placeholder='0.00'
                    style={{ textAlign: 'right' }}
                  />
                  <Input
                    value={line.description}
                    onChange={(e) => updateWithdrawalLine(idx, { description: e.target.value })}
                    placeholder='Line description'
                  />
                  <Combobox
                    options={fundOptions}
                    value={line.fund_id}
                    onChange={(value) => updateWithdrawalLine(idx, { fund_id: value })}
                    placeholder='Fund…'
                  />
                  <div style={{ textAlign: 'right', fontWeight: 600, color: '#1e293b' }}>
                    {fmt(withdrawalLineTotals[idx]?.gross.toFixed(2))}
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => onDeleteLine(idx)}
                    disabled={lines.length === 1}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </>
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gap: '0.5rem',
                  gridTemplateColumns: splitGridTemplateColumns,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  padding: '0 0.25rem',
                }}
              >
                <span>Amount</span>
                <span>Offset Account</span>
                <span>Fund</span>
                {showDonor && <span>Donor</span>}
                <span>Memo</span>
                <span>Action</span>
              </div>
              {depositLines.map((line, idx) => (
                <div key={idx} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: splitGridTemplateColumns }}>
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    <Input
                      value={line.amount}
                      onChange={(e) => updateDepositLine(idx, { amount: e.target.value })}
                      placeholder='Amount'
                    />
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => onFillAmount(idx)}
                      title='Fill remaining amount'
                      disabled={remainingAmount.lte(0)}
                    >
                      ⚡
                    </Button>
                  </div>
                  <Combobox
                    options={offsetAccountOptions}
                    value={line.offset_account_id}
                    onChange={(value) => updateDepositLine(idx, { offset_account_id: value })}
                    placeholder='Offset account…'
                  />
                  <Combobox
                    options={fundOptions}
                    value={line.fund_id}
                    onChange={(value) => updateDepositLine(idx, { fund_id: value })}
                    placeholder='Fund…'
                  />
                  {showDonor && (
                    <Combobox
                      options={donorOptions}
                      value={line.contact_id}
                      onChange={(value) => updateDepositLine(idx, { contact_id: value })}
                      placeholder='Donor…'
                    />
                  )}
                  <Input
                    value={line.memo}
                    onChange={(e) => updateDepositLine(idx, { memo: e.target.value })}
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
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button variant='secondary' size='sm' onClick={onAddLine}>Add Line</Button>
          <div style={{ color: remainingAmount.eq(0) ? '#166534' : '#b91c1c', fontSize: '0.82rem', fontWeight: 600 }}>
            Remaining: {fmt(remainingAmount.toFixed(2))}
          </div>
        </div>

        {legacyWarnings.length > 0 && (
          <div style={{ color: '#b45309', fontSize: '0.8rem' }}>
            Legacy split mapping detected on row {legacyWarnings.join(', ')}. Please select an active EXPENSE account.
          </div>
        )}

        {attempted && !isBalanced && (
          <div style={{ color: '#b91c1c', fontSize: '0.8rem' }}>
            Split lines must be complete and sum exactly to the row amount.
          </div>
        )}

        {isWithdrawal && isTaxRatesLoading && (
          <div style={{ color: '#475569', fontSize: '0.8rem' }}>
            Loading tax rates...
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Button variant='secondary' onClick={onClose}>Cancel</Button>
          <Button onClick={onSaveClick} disabled={!isBalanced || (isWithdrawal && isTaxRatesLoading)}>Save Split</Button>
        </div>
      </div>
    </Modal>
  );
}

const PreviewRow = memo(function PreviewRow({
  row,
  index,
  isSelected,
  onToggle,
  offsetOptions,
  donorOptions,
  payeeOptions,
  onOffsetChange,
  onReferenceChange,
  onContactChange,
  suggestions,
  onBillLink,
  onSplitOpen,
}: PreviewRowProps) {
  const isWithdrawal = row.type === 'withdrawal'
  const splits = row.splits ?? []
  const hasSplits = splits.length > 0
  const isLinked = isWithdrawal && !!row.bill_id
  const linkedBill = isLinked ? suggestions.find((suggestion) => suggestion.bill_id === row.bill_id) : null

  return (
    <div role='row' style={{ borderBottom: '1px solid #e5e7eb', padding: '0.65rem 0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.9rem', fontWeight: 600 }}>
        <input
          type='checkbox'
          checked={isSelected}
          onChange={onToggle}
          style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
        />
        <span role='cell' style={{ color: '#64748b', fontWeight: 600, minWidth: '2ch' }}>#{index + 1}</span>
        <span role='cell' style={{ color: '#334155', whiteSpace: 'nowrap' }}>{formatDateOnlyForDisplay(row.date)}</span>
        <span role='cell' style={{ color: '#111827', flex: '1 1 240px', minWidth: '180px' }}>{row.description}</span>
        <span role='cell' style={{ color: '#111827', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(row.amount)}</span>
        <span role='cell' style={{
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
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.7rem', alignItems: 'flex-start' }}>
        <div role='cell' style={{ ...PREVIEW_CONTROL_GROUP_STYLE, flex: '0 1 180px', minWidth: '140px' }}>
          <span style={PREVIEW_CONTROL_LABEL_STYLE}>Reference No</span>
          <Input
            value={row.reference_no || ''}
            onChange={(e) => onReferenceChange(index, e.target.value)}
            placeholder='Reference no...'
            maxLength={REFERENCE_NO_MAX_LENGTH}
          />
        </div>

        <div role='cell' style={PREVIEW_CONTROL_GROUP_STYLE}>
          <span style={PREVIEW_CONTROL_LABEL_STYLE}>Offset Account</span>
          {hasSplits ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', minHeight: '38px' }}>
              <span style={{ fontSize: '0.82rem', color: '#1d4ed8', fontWeight: 500 }}>
                Multiple ({splits.length} splits)
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
        </div>

        <div role='cell' style={PREVIEW_CONTROL_GROUP_STYLE}>
          <span style={PREVIEW_CONTROL_LABEL_STYLE}>Contact</span>
          {hasSplits || isLinked ? (
            <div style={{ color: '#9ca3af', minHeight: '38px', display: 'flex', alignItems: 'center' }}>—</div>
          ) : (
            <Combobox
              options={isWithdrawal ? payeeOptions : donorOptions}
              value={isWithdrawal ? (row.payee_id || '') : (row.contact_id || '')}
              onChange={(value) => onContactChange(index, Number(value) || undefined, row.type)}
              placeholder={isWithdrawal ? 'Payee…' : 'Donor…'}
            />
          )}
        </div>

        <div role='cell' style={{ ...PREVIEW_CONTROL_GROUP_STYLE, flex: '1 1 260px', minWidth: '220px' }}>
          <span style={PREVIEW_CONTROL_LABEL_STYLE}>Link to Bill</span>
          {hasSplits && <div style={{ color: '#9ca3af', minHeight: '38px', display: 'flex', alignItems: 'center' }}>Unavailable for split rows</div>}
          {!hasSplits && !isWithdrawal && <div style={{ color: '#9ca3af', minHeight: '38px', display: 'flex', alignItems: 'center' }}>—</div>}
          {!hasSplits && isWithdrawal && !isLinked && suggestions.length === 0 && (
            <div style={{ color: '#9ca3af', minHeight: '38px', display: 'flex', alignItems: 'center' }}>No suggested bill</div>
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
                    whiteSpace: 'normal',
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
                whiteSpace: 'normal',
                textAlign: 'left',
              }}
            >
              {linkedBill?.confidence === 'exact' ? 'Exact' : 'Possible'}: Bill {linkedBill?.bill_number || `#${row.bill_id}`} — {linkedBill?.vendor_name || 'Linked'} {linkedBill ? fmt(linkedBill.balance_due) : ''} (Unlink)
            </button>
          )}
        </div>

        <div role='cell' style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '110px', flex: '0 0 auto' }}>
          <span style={PREVIEW_CONTROL_LABEL_STYLE}>Actions</span>
          {!row.bill_id ? (
            <Button variant='ghost' size='sm' onClick={() => onSplitOpen(index)}>
              {hasSplits ? 'Edit Split' : 'Split'}
            </Button>
          ) : (
            <div style={{ color: '#9ca3af', minHeight: '38px', display: 'flex', alignItems: 'center' }}>Linked</div>
          )}
        </div>
      </div>
    </div>
  );
});

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
  const selectAllRef = useRef<HTMLInputElement | null>(null);

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
  }, [bankAccountOptions]);

  useEffect(() => {
    if (fundId !== '') return;
    const defaultFund = fundOptions[0];
    if (!defaultFund) return;
    setFundId(String(defaultFund.value));
  }, [fundOptions]);

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
      const next = [...prev]
      const current = next[index]
      if (!current) return prev
      next[index] = {
        ...current,
        bill_id: billId || undefined,
        splits: undefined,
        payee_id: undefined,
        contact_id: undefined,
      }
      return next
    })
  }, [])

  const onSplitOpen = useCallback((index: number, clear = false) => {
    if (clear) {
      setParsedRows((prev) => {
        const next = [...prev]
        const current = next[index]
        if (!current) return prev
        next[index] = {
          ...current,
          splits: undefined,
          offset_account_id: Number(current.offset_account_id) || 0,
          payee_id: undefined,
          contact_id: undefined,
        }
        return next
      })
      return
    }
    setSplitModalIndex(index)
  }, [])

  const onSplitClose = useCallback(() => setSplitModalIndex(null), [])

  const onSplitSave = useCallback((index: number, payload: SplitSavePayload) => {
    setParsedRows((prev) => {
      const next = [...prev]
      const current = next[index]
      if (!current) return prev
      const splitPayload = Array.isArray(payload) ? { splits: payload } : payload
      const normalizedSplits = splitPayload.splits || []
      next[index] = {
        ...current,
        splits: normalizedSplits.length > 0 ? normalizedSplits : undefined,
        payee_id: 'payee_id' in splitPayload ? splitPayload.payee_id || undefined : undefined,
        contact_id: normalizedSplits.length > 0 ? undefined : current.contact_id,
        offset_account_id: normalizedSplits.length > 0 ? undefined : Number(current.offset_account_id) || 0,
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

  const allSelected = parsedRows.length > 0 && selectedRows.size === parsedRows.length;
  const someSelected = selectedRows.size > 0 && selectedRows.size < parsedRows.length;
  const onToggleAll = useCallback(() => {
    setSelectedRows(allSelected ? new Set<number>() : new Set<number>(parsedRows.map((_, i) => i)));
  }, [allSelected, parsedRows]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  async function loadBillMatches(nextRows: ParsedImportRow[], nextBankAccountId: number) {
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

      const grouped: Record<number, BillMatchSuggestion[]> = {}
      ;(result.suggestions || []).forEach((suggestion) => {
        ;(grouped[suggestion.row_index] ??= []).push(suggestion)
      })
      setSuggestionsByRow(grouped)
    } catch (err) {
      setMatchLoadError(getErrorMessage(err, 'Failed to load bill match suggestions.'))
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
      const donorByEmail = new Map<string, ContactSummary | null>();
      const donorByName = new Map<string, ContactSummary | null>();
      const householdEntries: Array<[string, ContactSummary]> = [];
      for (const contact of donorContacts) {
        if (!contact.is_active) continue;

        if (contact.email) {
          const emailKey = normalize(contact.email);
          if (!donorByEmail.has(emailKey)) {
            donorByEmail.set(emailKey, contact);
          } else {
            const existing = donorByEmail.get(emailKey);
            if (!existing) {
            } else if (contact.contact_class === 'HOUSEHOLD' && existing.contact_class !== 'HOUSEHOLD') {
              donorByEmail.set(emailKey, contact);
            } else if (contact.contact_class === existing.contact_class) {
              donorByEmail.set(emailKey, null);
            }
          }
        }

        const nameKey = normalize(contact.name);
        if (!donorByName.has(nameKey)) {
          donorByName.set(nameKey, contact);
        } else {
          const existing = donorByName.get(nameKey);
          if (!existing) {
          } else if (contact.contact_class === 'HOUSEHOLD' && existing.contact_class !== 'HOUSEHOLD') {
            donorByName.set(nameKey, contact);
          } else if (contact.contact_class === existing.contact_class) {
            donorByName.set(nameKey, null);
          }
        }
      }

      for (const [nameKey, contact] of donorByName) {
        if (contact && contact.contact_class === 'HOUSEHOLD') {
          householdEntries.push([nameKey, contact]);
        }
      }

      const AUTODEPOSIT_DESC = 'e-transfer - autodeposit';
      const mappedRows = result.rows.map((row, i) => {
        const metadata = result.metadata?.[i];
        const etransferPrefill = isEtransferDeposit(row, metadata) ? defaultEtransferOffsetId : 0;
        const base = { ...row, offset_account_id: etransferPrefill };
        if (row.type !== 'deposit') return base;
        if (normalize(metadata?.description_1) !== AUTODEPOSIT_DESC) return base;

        const fromEmail = normalize(metadata?.from);
        const senderName = normalize(metadata?.sender);

        let matchedId: number | null = null;

        if (fromEmail) {
          const emailMatch = donorByEmail.get(fromEmail);
          if (emailMatch) matchedId = emailMatch.id;
        }

        if (!matchedId && senderName) {
          const exactMatch = donorByName.get(senderName);

          let householdPartialId: number | null = null;
          let multipleHouseholdPartials = false;
          for (const [nameKey, contact] of householdEntries) {
            if (nameKey === senderName) continue;
            if (nameKey && (senderName.includes(nameKey) || nameKey.includes(senderName))) {
              if (householdPartialId !== null) {
                multipleHouseholdPartials = true;
                householdPartialId = null;
                break;
              }
              householdPartialId = contact.id;
            }
          }

          if (householdPartialId && !multipleHouseholdPartials) {
            if (exactMatch && exactMatch.contact_class === 'HOUSEHOLD') {
              matchedId = exactMatch.id;
            } else {
              matchedId = householdPartialId;
            }
          } else if (exactMatch) {
            matchedId = exactMatch.id;
          }
        }

        if (matchedId) base.contact_id = matchedId;
        return base;
      });
      setParsedRows(mappedRows);
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
    const nextRows = parsedRows
    setParsedRows(nextRows);
    setSelectedRows(new Set<number>(nextRows.map((_, i) => i)));
    setPhase('preview');
    await loadBillMatches(nextRows, Number(bankAccountId));
  }

  async function handleImport(force: boolean) {
    if (selectedRows.size === 0) {
      setErrors(['Please select at least one row to import']);
      return;
    }

    const nextErrors: string[] = [];
    const nextBankAccountId = Number(bankAccountId);
    const nextFundId = Number(fundId);

    parsedRows.forEach((row, idx) => {
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
      const payload: ImportTransactionsInput = {
        bank_account_id: nextBankAccountId,
        fund_id: nextFundId,
        rows: parsedRows
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
                  onSave={(payload) => onSplitSave(splitModalIndex, payload)}
                  row={parsedRows[splitModalIndex]}
                  defaultFundId={Number(fundId)}
                  offsetAccountOptions={offsetAccountOptions}
                  fundOptions={fundOptions}
                  expenseAccountOptions={expenseAccountOptions}
                  activeExpenseAccountIds={activeExpenseAccountIds}
                />
              )}

              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: '65vh' }}>
                <div style={{ background: '#f8fafc', color: '#6b7280', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', padding: '0.55rem 0.75rem', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <input
                    ref={selectAllRef}
                    type='checkbox'
                    checked={allSelected}
                    onChange={onToggleAll}
                    style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <span>Preview Rows</span>
                </div>
                <div role='table' aria-label='Import transaction preview' style={{ fontSize: '0.82rem' }}>
                  <div role='rowgroup' style={SR_ONLY_STYLE}>
                    <div role='row'>
                      {['#', 'Date', 'Description', 'Amount', 'Type', 'Reference No', 'Offset Account', 'Contact', 'Link to Bill', 'Actions'].map((header) => (
                        <span key={header} role='columnheader'>{header}</span>
                      ))}
                    </div>
                  </div>
                  <div role='rowgroup'>
                  {parsedRows.map((row, idx) => (
                    <PreviewRow
                      key={`${row.date}-${row.description}-${idx}`}
                      row={row}
                      index={idx}
                      isSelected={selectedRows.has(idx)}
                      onToggle={() => onToggleRow(idx)}
                      offsetOptions={offsetAccountOptions}
                      donorOptions={donorOptions}
                      payeeOptions={payeeOptions}
                      onOffsetChange={onOffsetChange}
                      onReferenceChange={onReferenceChange}
                      onContactChange={onContactChange}
                      suggestions={suggestionsByRow[idx + 1] || []}
                      onBillLink={onBillLink}
                      onSplitOpen={onSplitOpen}
                    />
                  ))}
                  </div>
                </div>
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
