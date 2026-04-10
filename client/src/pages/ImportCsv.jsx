import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import Decimal from 'decimal.js';
import { useNavigate } from 'react-router-dom';
import { useImportTransactions, useGetBillMatches } from '../api/useTransactions';
import { useAccounts } from '../api/useAccounts';
import { useFunds } from '../api/useFunds';
import { useContacts } from '../api/useContacts';
import { useTaxRates } from '../api/useTaxRates';
import { useToast } from '../components/ui/Toast';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Combobox from '../components/ui/Combobox';
import Modal from '../components/ui/Modal';
import { parseStatementCsv } from '../utils/parseStatementCsv';
import { formatDateOnlyForDisplay } from '../utils/date';

const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
const MAX_ROUNDING_ADJUSTMENT = new Decimal('0.10');
const dec = (value) => {
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
}) {
  const [lines, setLines] = useState([]);
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

  const payeeOptions = useMemo(() => (
    payeeContacts
      .filter((contact) => contact.is_active)
      .map((contact) => ({ value: contact.id, label: contact.name }))
  ), [payeeContacts]);

  const taxRateOptions = useMemo(() => ([
    { value: '', label: 'Exempt' },
    ...taxRates.map((taxRate) => ({
      value: String(taxRate.id),
      label: `${taxRate.name} (${(taxRate.rate * 100).toFixed(2)}%)`,
    })),
  ]), [taxRates]);

  const taxRateMap = useMemo(
    () => Object.fromEntries(taxRates.map((taxRate) => [String(taxRate.id), taxRate])),
    [taxRates]
  );

  useEffect(() => {
    if (!isOpen) return;

    if (isWithdrawal) {
      let nextPayee = row?.payee_id ? String(row.payee_id) : '';
      if (row?.splits?.length > 0) {
        setLines(row.splits.map((split) => {
          const isLegacyMapped = split.expense_account_id === undefined && split.offset_account_id !== undefined;
          if (!nextPayee && split.contact_id) nextPayee = String(split.contact_id);
          return {
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
    setPayeeId('');
    setAttempted(false);
  }, [isOpen, row, defaultFundId, isWithdrawal]);

  if (!isOpen || !row) return null;

  const rowAmount = dec(row.amount).toDecimalPlaces(2);
  const withdrawalLineTotals = lines.map((line) => {
    const preTax = dec(line.pre_tax_amount).toDecimalPlaces(2);
    const rounding = dec(line.rounding_adjustment || 0).toDecimalPlaces(2);
    const taxRate = line.tax_rate_id ? taxRateMap[line.tax_rate_id] : null;
    const tax = taxRate ? preTax.times(dec(taxRate.rate)).toDecimalPlaces(2) : dec(0);
    const gross = preTax.plus(tax).plus(rounding).toDecimalPlaces(2);
    return { preTax, rounding, tax, gross, taxRate };
  });
  const assignedAmount = lines.reduce((sum, line, idx) => (
    sum.plus(isWithdrawal ? withdrawalLineTotals[idx].gross : dec(line.amount).toDecimalPlaces(2))
  ), dec(0)).toDecimalPlaces(2);
  const remainingAmount = rowAmount.minus(assignedAmount).toDecimalPlaces(2);
  const hasValidDepositLines = lines.length > 0 && lines.every((line) => {
    const amount = Number(line.amount);
    return Number.isFinite(amount)
      && amount > 0
      && Number.isInteger(Number(line.offset_account_id))
      && Number(line.offset_account_id) > 0
      && Number.isInteger(Number(line.fund_id))
      && Number(line.fund_id) > 0;
  });
  const hasValidWithdrawalLines = lines.length > 0 && lines.every((line, idx) => {
    const totals = withdrawalLineTotals[idx];
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
        line.is_legacy_mapped
        && Number(line.expense_account_id) > 0
        && !activeExpenseAccountIds.includes(Number(line.expense_account_id))
      ))
      .map(({ idx }) => idx + 1)
    : [];

  const updateLine = (index, patch) => {
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const onAddLine = () => {
    if (isWithdrawal) {
      setLines((prev) => [...prev, {
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
    const currentAmount = dec(lines[index]?.amount).toDecimalPlaces(2);
    const nextAmount = remainingAmount.plus(currentAmount).toDecimalPlaces(2);
    updateLine(index, { amount: nextAmount.toFixed(2) });
  };

  const onSaveClick = () => {
    if (!isBalanced) {
      setAttempted(true);
      return;
    }

    if (isWithdrawal) {
      onSave({
        payee_id: Number(payeeId),
        splits: lines.map((line, idx) => ({
          amount: parseFloat(withdrawalLineTotals[idx].gross.toFixed(2)),
          fund_id: Number(line.fund_id),
          expense_account_id: Number(line.expense_account_id),
          tax_rate_id: line.tax_rate_id ? Number(line.tax_rate_id) : null,
          pre_tax_amount: parseFloat(withdrawalLineTotals[idx].preTax.toFixed(2)),
          rounding_adjustment: parseFloat(withdrawalLineTotals[idx].rounding.toFixed(2)),
          description: line.description ? line.description.trim() || null : null,
        })),
      });
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
    <Modal isOpen={isOpen} onClose={onClose} title='Split Transaction' width='1050px'>
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
              {lines.map((line, idx) => (
                <div key={idx} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: withdrawalGridTemplateColumns, alignItems: 'center' }}>
                  <Combobox
                    options={expenseAccountOptions}
                    value={line.expense_account_id}
                    onChange={(value) => updateLine(idx, { expense_account_id: value })}
                    placeholder='Expense account…'
                  />
                  <Combobox
                    options={taxRateOptions}
                    value={line.tax_rate_id}
                    onChange={(value) => updateLine(idx, { tax_rate_id: value })}
                    placeholder='Tax type…'
                  />
                  <Input
                    type='number'
                    min='0'
                    step='0.01'
                    value={line.pre_tax_amount}
                    onChange={(e) => updateLine(idx, { pre_tax_amount: e.target.value })}
                    placeholder='0.00'
                    style={{ textAlign: 'right' }}
                  />
                  <Input
                    type='number'
                    min={MAX_ROUNDING_ADJUSTMENT.times(-1).toFixed(2)}
                    max={MAX_ROUNDING_ADJUSTMENT.toFixed(2)}
                    step='0.01'
                    value={line.rounding_adjustment}
                    onChange={(e) => updateLine(idx, { rounding_adjustment: e.target.value })}
                    placeholder='0.00'
                    style={{ textAlign: 'right' }}
                  />
                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                    placeholder='Line description'
                  />
                  <Combobox
                    options={fundOptions}
                    value={line.fund_id}
                    onChange={(value) => updateLine(idx, { fund_id: value })}
                    placeholder='Fund…'
                  />
                  <div style={{ textAlign: 'right', fontWeight: 600, color: '#1e293b' }}>
                    {fmt(withdrawalLineTotals[idx].gross.toFixed(2))}
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
              {lines.map((line, idx) => (
                <div key={idx} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: splitGridTemplateColumns }}>
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
                      disabled={remainingAmount.lte(0)}
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
  offsetOptions,
  donorOptions,
  payeeOptions,
  onOffsetChange,
  onContactChange,
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
      <td style={{ padding: '0.5rem' }}>{row.description}</td>
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
      <td style={{ padding: '0.5rem', minWidth: '160px' }}>
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
      <td style={{ padding: '0.5rem', minWidth: '160px' }}>
        {hasSplits || isLinked ? (
          <span style={{ color: '#9ca3af' }}>—</span>
        ) : (
          <Combobox
            options={isWithdrawal ? payeeOptions : donorOptions}
            value={isWithdrawal ? (row.payee_id || '') : (row.contact_id || '')}
            onChange={(value) => onContactChange(index, Number(value) || undefined, row.type)}
            placeholder={isWithdrawal ? 'Payee…' : 'Donor…'}
          />
        )}
      </td>
      <td style={{ padding: '0.5rem', minWidth: '160px' }}>
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
  const { data: donorContacts = [] } = useContacts({ type: 'DONOR' });
  const { data: payeeContacts = [] } = useContacts({ type: 'PAYEE' });
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

  const expenseAccountOptions = useMemo(
    () => activeAccounts
      .filter((a) => a.type === 'EXPENSE')
      .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [activeAccounts]
  );

  const activeExpenseAccountIds = useMemo(
    () => activeAccounts.filter((a) => a.type === 'EXPENSE').map((a) => a.id),
    [activeAccounts]
  );

  const donorOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...donorContacts
      .filter((contact) => contact.is_active)
      .map((contact) => ({
        value: contact.id,
        label: contact.donor_id ? `${contact.donor_id} — ${contact.name}` : contact.name,
      })),
  ], [donorContacts]);

  const payeeOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...payeeContacts
      .filter((contact) => contact.is_active)
      .map((contact) => ({ value: contact.id, label: contact.name })),
  ], [payeeContacts]);

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

  const onContactChange = useCallback((index, contactId, type) => {
    setParsedRows((prev) => {
      const next = [...prev];
      if (type === 'withdrawal') {
        next[index] = { ...next[index], payee_id: contactId || undefined };
      } else {
        next[index] = { ...next[index], contact_id: contactId || undefined };
      }
      return next;
    });
  }, []);

  const onBillLink = useCallback((index, billId) => {
    setParsedRows((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        bill_id: billId || undefined,
        splits: undefined,
        payee_id: undefined,
        contact_id: undefined,
      }
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
          payee_id: undefined,
          contact_id: undefined,
        }
        return next
      })
      return
    }
    setSplitModalIndex(index)
  }, [defaultOffsetAccountId])

  const onSplitClose = useCallback(() => setSplitModalIndex(null), [])

  const onSplitSave = useCallback((index, payload) => {
    setParsedRows((prev) => {
      const next = [...prev]
      const splitPayload = Array.isArray(payload) ? { splits: payload } : payload
      const normalizedSplits = splitPayload.splits || []
      next[index] = {
        ...next[index],
        splits: normalizedSplits.length > 0 ? normalizedSplits : undefined,
        payee_id: splitPayload.payee_id || undefined,
        contact_id: normalizedSplits.length > 0 ? undefined : next[index].contact_id,
        offset_account_id: normalizedSplits.length > 0 ? undefined : Number(next[index].offset_account_id) || 0,
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
        const splitTotal = row.splits.reduce((sum, split) => (
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
          payee_id: row.payee_id ? Number(row.payee_id) : undefined,
          contact_id: row.contact_id ? Number(row.contact_id) : undefined,
          bill_id: row.bill_id,
          splits: row.splits?.length > 0
            ? row.splits.map((split) => ({
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
                  onSave={(payload) => onSplitSave(splitModalIndex, payload)}
                  row={parsedRows[splitModalIndex]}
                  defaultFundId={Number(fundId)}
                  offsetAccountOptions={offsetAccountOptions}
                  fundOptions={fundOptions}
                  expenseAccountOptions={expenseAccountOptions}
                  activeExpenseAccountIds={activeExpenseAccountIds}
                />
              )}

              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflowX: 'hidden', overflowY: 'auto', maxHeight: '65vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#6b7280', textAlign: 'left' }}>
                      <th style={{ padding: '0.55rem' }}>#</th>
                      <th style={{ padding: '0.55rem' }}>Date</th>
                      <th style={{ padding: '0.55rem' }}>Description</th>
                      <th style={{ padding: '0.55rem', textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '0.55rem' }}>Type</th>
                      <th style={{ padding: '0.55rem' }}>Offset Account</th>
                      <th style={{ padding: '0.55rem' }}>Contact</th>
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
                        donorOptions={donorOptions}
                        payeeOptions={payeeOptions}
                        onOffsetChange={onOffsetChange}
                        onContactChange={onContactChange}
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
