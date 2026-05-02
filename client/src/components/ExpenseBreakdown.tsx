import Combobox from './ui/Combobox';
import Input from './ui/Input';
import Select from './ui/Select';
import type { OptionValue, SelectOption } from './ui/types';

interface ExpenseBreakdownLine {
  id: string | number;
  expense_account_id: OptionValue | '';
  description: string;
  tax_rate_id: OptionValue | '';
  amount: string | number;
  rounding_adjustment: string | number;
}

interface ExpenseLineTotal {
  gross?: number;
  tax?: number;
  taxName?: string | null;
}

type ExpenseLineErrors = Partial<Record<keyof ExpenseBreakdownLine, string>>;

interface ExpenseBreakdownProps {
  lines: ExpenseBreakdownLine[];
  lineTotals: ExpenseLineTotal[];
  expenseAccountOptions: SelectOption[];
  taxRateOptions: SelectOption[];
  onChange: (index: number, field: keyof ExpenseBreakdownLine, value: OptionValue | string) => void;
  onRemove: (index: number) => void;
  errors?: ExpenseLineErrors[];
  readOnly?: boolean;
  showGrossColumn?: boolean;
  minWidth?: number;
}

const fmt = (value: unknown) => '$' + Number(value || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });

export default function ExpenseBreakdown({
  lines,
  lineTotals,
  expenseAccountOptions,
  taxRateOptions,
  onChange,
  onRemove,
  errors,
  readOnly = false,
  showGrossColumn = false,
  minWidth = 700,
}: ExpenseBreakdownProps) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '1rem', overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: `${minWidth}px`, borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', width: showGrossColumn ? '24%' : '28%', fontWeight: 500, color: '#6b7280' }}>
              Account
            </th>
            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', width: showGrossColumn ? '18%' : '20%', fontWeight: 500, color: '#6b7280' }}>
              Description
            </th>
            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', width: showGrossColumn ? '14%' : '14%', fontWeight: 500, color: '#6b7280' }}>
              Tax
            </th>
            <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', width: showGrossColumn ? '14%' : '16%', fontWeight: 500, color: '#6b7280' }}>
              Amount (before tax)
            </th>
            <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', width: showGrossColumn ? '12%' : '14%', fontWeight: 500, color: '#6b7280' }}>
              Rounding
            </th>
            {showGrossColumn && (
              <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', width: '12%', fontWeight: 500, color: '#6b7280' }}>
                Gross
              </th>
            )}
            <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', width: '8%', fontWeight: 500, color: '#6b7280' }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => {
            const lineError = errors?.[idx] || {};
            const { gross = 0, tax = 0, taxName = null } = lineTotals[idx] || {};
            const taxDisabled = !line.expense_account_id;
            const showTaxHint = tax !== 0 && typeof taxName === 'string' && taxName.trim() !== '';

            return (
              <tr key={line.id} style={{ borderBottom: idx < lines.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                <td style={{ padding: '0.5rem' }}>
                  <Combobox
                    options={expenseAccountOptions}
                    value={line.expense_account_id}
                    onChange={(value) => onChange(idx, 'expense_account_id', value)}
                    placeholder="Select..."
                    error={lineError.expense_account_id}
                    disabled={readOnly}
                  />
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <Input
                    value={line.description}
                    onChange={(event) => onChange(idx, 'description', event.target.value)}
                    placeholder="Description"
                    error={lineError.description}
                    disabled={readOnly}
                  />
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <div>
                    <Select
                      options={taxRateOptions}
                      value={line.tax_rate_id}
                      onChange={(event) => onChange(idx, 'tax_rate_id', event.target.value)}
                      disabled={readOnly || taxDisabled}
                      style={{ opacity: taxDisabled ? 0.5 : 1 }}
                    />
                    {showTaxHint && (
                      <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: '0.2rem', textAlign: 'right' }}>
                        {taxName}: {fmt(tax)}
                      </div>
                    )}
                  </div>
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <Input
                    aria-label={`Amount (before tax) line ${idx + 1}`}
                    type="number"
                    step="0.01"
                    value={line.amount}
                    onChange={(event) => onChange(idx, 'amount', event.target.value)}
                    placeholder="0.00"
                    error={lineError.amount}
                    style={{ textAlign: 'right' }}
                    disabled={readOnly}
                    min="0"
                  />
                  {!showGrossColumn && tax !== 0 && (
                    <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: '0.2rem', textAlign: 'right' }}>
                      Total incl. tax: {fmt(gross)}
                    </div>
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <Input
                    aria-label={`Rounding line ${idx + 1}`}
                    type="number"
                    step="0.01"
                    min="-0.10"
                    max="0.10"
                    value={line.rounding_adjustment}
                    onChange={(event) => onChange(idx, 'rounding_adjustment', event.target.value)}
                    placeholder="0.00"
                    error={lineError.rounding_adjustment}
                    style={{ textAlign: 'right' }}
                    disabled={readOnly}
                  />
                </td>
                {showGrossColumn && (
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#1e293b' }}>
                    {fmt(gross)}
                  </td>
                )}
                <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                  {lines.length > 1 && !readOnly && (
                    <button
                      type="button"
                      onClick={() => onRemove(idx)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#dc2626',
                        fontSize: '1.2rem',
                        width: '28px',
                        height: '28px',
                        padding: 0,
                        lineHeight: 1,
                      }}
                      title="Remove line"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
