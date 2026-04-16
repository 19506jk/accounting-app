import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';

import { useTaxRates } from '../../api/useTaxRates';
import Button from '../../components/ui/Button';
import Combobox from '../../components/ui/Combobox';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import { formatDateOnlyForDisplay } from '../../utils/date';
import { dec, fmt } from './importCsvHelpers';
import type { TaxRateSummary } from '@shared/contracts';
import type { SelectOption } from '../../components/ui/types';
import type {
  DepositSplitModalLine,
  ParsedImportRow,
  SplitModalLine,
  SplitSavePayload,
  WithdrawalSplitModalLine,
} from './importCsvTypes';

const MAX_ROUNDING_ADJUSTMENT = new Decimal('0.10');

interface SplitTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: SplitSavePayload) => void;
  row: ParsedImportRow | undefined;
  defaultFundId: number;
  offsetAccountOptions: SelectOption[];
  fundOptions: SelectOption[];
  donorOptions: SelectOption[];
  payeeOptions: SelectOption[];
  expenseAccountOptions: SelectOption[];
  activeExpenseAccountIds: number[];
}

interface WithdrawalLineTotal {
  preTax: Decimal;
  rounding: Decimal;
  tax: Decimal;
  gross: Decimal;
  taxRate: TaxRateSummary | null;
}

export default function SplitTransactionModal({
  isOpen,
  onClose,
  onSave,
  row,
  defaultFundId,
  offsetAccountOptions,
  fundOptions,
  donorOptions,
  payeeOptions,
  expenseAccountOptions,
  activeExpenseAccountIds,
}: SplitTransactionModalProps) {
  const [lines, setLines] = useState<SplitModalLine[]>([]);
  const [payeeId, setPayeeId] = useState('');
  const [attempted, setAttempted] = useState(false);
  const taxRatesQuery = useTaxRates({ activeOnly: true });
  const taxRates = taxRatesQuery.data || [];
  const isTaxRatesLoading = taxRatesQuery.isPending;
  const isWithdrawal = row?.type === 'withdrawal';

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
