import { memo, useCallback, useEffect, useRef } from 'react';

import Button from '../../components/ui/Button';
import Combobox from '../../components/ui/Combobox';
import Input from '../../components/ui/Input';
import { formatDateOnlyForDisplay } from '../../utils/date';
import { fmt } from './importCsvHelpers';
import type { BillMatchSuggestion } from '@shared/contracts';
import type { SelectOption } from '../../components/ui/types';
import type { ParsedImportRow, TransactionRowType } from './importCsvTypes';
import type React from 'react';

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

interface ImportPreviewTableProps {
  rows: ParsedImportRow[];
  selectedRows: Set<number>;
  suggestionsByRow: Record<number, BillMatchSuggestion[]>;
  offsetOptions: SelectOption[];
  donorOptions: SelectOption[];
  payeeOptions: SelectOption[];
  onSelectedRowsChange: (selectedRows: Set<number>) => void;
  onToggleRow: (index: number) => void;
  onOffsetChange: (index: number, offsetId: number) => void;
  onReferenceChange: (index: number, referenceNo: string) => void;
  onContactChange: (index: number, contactId: number | undefined, type: TransactionRowType) => void;
  onBillLink: (index: number, billId: number | null) => void;
  onSplitOpen: (index: number, clear?: boolean) => void;
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
  const isWithdrawal = row.type === 'withdrawal';
  const splits = row.splits ?? [];
  const hasSplits = splits.length > 0;
  const isLinked = isWithdrawal && !!row.bill_id;
  const linkedBill = isLinked ? suggestions.find((suggestion) => suggestion.bill_id === row.bill_id) : null;

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

export default function ImportPreviewTable({
  rows,
  selectedRows,
  suggestionsByRow,
  offsetOptions,
  donorOptions,
  payeeOptions,
  onSelectedRowsChange,
  onToggleRow,
  onOffsetChange,
  onReferenceChange,
  onContactChange,
  onBillLink,
  onSplitOpen,
}: ImportPreviewTableProps) {
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const allSelected = rows.length > 0 && selectedRows.size === rows.length;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rows.length;

  const onToggleAll = useCallback(() => {
    onSelectedRowsChange(allSelected ? new Set<number>() : new Set<number>(rows.map((_, i) => i)));
  }, [allSelected, onSelectedRowsChange, rows]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
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
          {rows.map((row, idx) => (
            <PreviewRow
              key={`${row.date}-${row.description}-${idx}`}
              row={row}
              index={idx}
              isSelected={selectedRows.has(idx)}
              onToggle={() => onToggleRow(idx)}
              offsetOptions={offsetOptions}
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
  );
}
