import Input from '../../components/ui/Input';
import Combobox from '../../components/ui/Combobox';
import type React from 'react';
import type { SelectOption } from '../../components/ui/types';

interface ImportSetupPanelProps {
  bankAccountId: string;
  fundId: string;
  bankAccountOptions: SelectOption[];
  fundOptions: SelectOption[];
  isParsing: boolean;
  parsedRowCount: number;
  parseError: string;
  parseWarnings: string[];
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBankAccountChange: (value: string) => void;
  onFundChange: (value: string) => void;
}

export default function ImportSetupPanel({
  bankAccountId,
  fundId,
  bankAccountOptions,
  fundOptions,
  isParsing,
  parsedRowCount,
  parseError,
  parseWarnings,
  onFileChange,
  onBankAccountChange,
  onFundChange,
}: ImportSetupPanelProps) {
  return (
    <>
      <Input label="CSV File" type="file" accept=".csv,text/csv,application/vnd.ms-excel" onChange={onFileChange} />

      <div style={{ display: 'grid', gap: '0.8rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <Combobox
          label="Bank Account"
          options={bankAccountOptions}
          value={bankAccountId ? Number(bankAccountId) : ''}
          onChange={(value) => onBankAccountChange(String(value))}
          placeholder="Select bank account…"
        />
        <Combobox
          label="Fund"
          options={fundOptions}
          value={fundId ? Number(fundId) : ''}
          onChange={(value) => onFundChange(String(value))}
          placeholder="Select fund…"
        />
      </div>

      <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
        {isParsing ? 'Parsing CSV…' : parsedRowCount > 0 ? `${parsedRowCount} rows found` : 'No rows parsed yet'}
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
  );
}
