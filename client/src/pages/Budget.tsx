import { useEffect, useMemo, useState } from 'react'
import { useBudget, useUpdateBudget } from '../api/useBudget'
import { useSettings } from '../api/useSettings'
import { getCurrentFiscalYear } from '../utils/fiscalYear'
import type { AccountBudgetRow } from '@shared/contracts'

const fmt = (n: number | string | null | undefined) =>
  '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 })

function BudgetRow({
  row,
  fiscalYear,
  onSave,
}: {
  row: AccountBudgetRow
  fiscalYear: number
  onSave: (accountId: number, amount: number) => void
}) {
  const [localAmount, setLocalAmount] = useState(row.budget_amount.toFixed(2))

  useEffect(() => {
    setLocalAmount(row.budget_amount.toFixed(2))
  }, [row.budget_amount, fiscalYear])

  const handleBlur = () => {
    const amount = parseFloat(localAmount)
    const normalized = isNaN(amount) || amount < 0 ? 0 : amount
    if (normalized !== row.budget_amount) {
      onSave(row.account_id, normalized)
    }
    setLocalAmount(normalized.toFixed(2))
  }

  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
      <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#64748b' }}>
        {row.account_code}
      </td>
      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.875rem' }}>{row.account_name}</td>
      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontSize: '0.875rem', color: '#374151' }}>
        {fmt(row.prior_actual_amount)}
      </td>
      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontSize: '0.875rem', color: '#374151' }}>
        {fmt(row.prior_budget_amount)}
      </td>
      <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right' }}>
        <input
          type="number"
          min="0"
          step="0.01"
          value={localAmount}
          onChange={(e) => setLocalAmount(e.target.value)}
          onBlur={handleBlur}
          style={{
            width: '130px',
            padding: '0.35rem 0.5rem',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '0.875rem',
            textAlign: 'right',
          }}
        />
      </td>
    </tr>
  )
}

function TotalsRow({ label, rows, col }: { label: string; rows: AccountBudgetRow[]; col: keyof AccountBudgetRow }) {
  const total = rows.reduce((sum, r) => sum + (r[col] as number), 0)
  return (
    <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc', fontWeight: 600 }}>
      <td colSpan={2} style={{ padding: '0.6rem 0.75rem', fontSize: '0.875rem' }}>{label}</td>
      <td />
      <td />
      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontSize: '0.875rem', fontFamily: 'monospace' }}>
        {fmt(total)}
      </td>
    </tr>
  )
}

type NumCol = 'budget_amount' | 'actual_amount' | 'prior_budget_amount' | 'prior_actual_amount'

const sumCol = (rows: AccountBudgetRow[], col: NumCol) =>
  rows.reduce((s, r) => s + r[col], 0)

// Variance = actual − budget. Favorable when income/net exceed budget, or when
// expenses come in under budget.
const fmtDiff = (budget: number, actual: number) => {
  const diff = actual - budget
  return `${diff > 0 ? '+' : diff < 0 ? '-' : ''}${fmt(Math.abs(diff))}`
}

const fmtPct = (budget: number, actual: number) => {
  if (!budget) return '—'
  const pct = ((actual - budget) / Math.abs(budget)) * 100
  return `${pct > 0 ? '+' : pct < 0 ? '-' : ''}${Math.abs(pct).toFixed(1)}%`
}

const varianceColor = (type: 'INCOME' | 'EXPENSE' | 'NET', budget: number, actual: number) => {
  if (actual === budget) return '#374151'
  const favorable = type === 'EXPENSE' ? actual < budget : actual > budget
  return favorable ? '#16a34a' : '#dc2626'
}

const SUM_TH: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  fontSize: '0.68rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#9ca3af',
  textAlign: 'right',
  whiteSpace: 'nowrap',
}

const SUM_TD: React.CSSProperties = {
  padding: '0.45rem 0.75rem',
  fontSize: '0.82rem',
  textAlign: 'right',
  fontFamily: 'monospace',
  color: '#374151',
}

const SUM_GROUP: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.7rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#6b7280',
  background: '#f8fafc',
}

function SummaryRow({
  label,
  type,
  budget,
  actual,
  showVariance,
  bold,
}: {
  label: string
  type: 'INCOME' | 'EXPENSE' | 'NET'
  budget: number
  actual: number
  showVariance: boolean
  bold?: boolean
}) {
  const weight = bold ? 700 : 400
  const color = varianceColor(type, budget, actual)
  return (
    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
      <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem', fontWeight: bold ? 700 : 600, color: '#0f172a' }}>{label}</td>
      <td style={{ ...SUM_TD, fontWeight: weight }}>{fmt(budget)}</td>
      <td style={{ ...SUM_TD, fontWeight: weight }}>{fmt(actual)}</td>
      <td style={{ ...SUM_TD, fontWeight: weight, color: showVariance ? color : '#9ca3af' }}>
        {showVariance ? fmtDiff(budget, actual) : '—'}
      </td>
      <td style={{ ...SUM_TD, fontWeight: weight, color: showVariance ? color : '#9ca3af' }}>
        {showVariance ? fmtPct(budget, actual) : '—'}
      </td>
    </tr>
  )
}

function SummaryPanel({
  selectedYear,
  priorYear,
  incomeRows,
  expenseRows,
}: {
  selectedYear: number
  priorYear: number
  incomeRows: AccountBudgetRow[]
  expenseRows: AccountBudgetRow[]
}) {
  const incBudget = sumCol(incomeRows, 'budget_amount')
  const incActual = sumCol(incomeRows, 'actual_amount')
  const expBudget = sumCol(expenseRows, 'budget_amount')
  const expActual = sumCol(expenseRows, 'actual_amount')

  const incPriorBudget = sumCol(incomeRows, 'prior_budget_amount')
  const incPriorActual = sumCol(incomeRows, 'prior_actual_amount')
  const expPriorBudget = sumCol(expenseRows, 'prior_budget_amount')
  const expPriorActual = sumCol(expenseRows, 'prior_actual_amount')

  return (
    <div style={{ marginBottom: '1.25rem', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...SUM_TH, textAlign: 'left' }} />
            <th style={SUM_TH}>Budget</th>
            <th style={SUM_TH}>Actual</th>
            <th style={SUM_TH}>Difference</th>
            <th style={SUM_TH}>%</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={5} style={SUM_GROUP}>FY{selectedYear} Summary</td>
          </tr>
          <SummaryRow label="Total Income" type="INCOME" budget={incBudget} actual={incActual} showVariance />
          <SummaryRow label="Total Expenses" type="EXPENSE" budget={expBudget} actual={expActual} showVariance />
          <SummaryRow label="Net" type="NET" budget={incBudget - expBudget} actual={incActual - expActual} showVariance bold />

          <tr>
            <td colSpan={5} style={{ ...SUM_GROUP, borderTop: '2px solid #e2e8f0' }}>FY{priorYear} (Prior Year)</td>
          </tr>
          <SummaryRow label="Total Income" type="INCOME" budget={incPriorBudget} actual={incPriorActual} showVariance={false} />
          <SummaryRow label="Total Expenses" type="EXPENSE" budget={expPriorBudget} actual={expPriorActual} showVariance={false} />
        </tbody>
      </table>
    </div>
  )
}

const TH_STYLE: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  textAlign: 'left',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: '2px solid #e2e8f0',
  background: '#f8fafc',
  whiteSpace: 'nowrap',
}

const GROUP_HEADER_STYLE: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.7rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#9ca3af',
  background: '#f1f5f9',
}

export default function Budget() {
  const { data: settings } = useSettings()
  const fiscalStartMonth = Math.max(1, Math.min(12, parseInt(settings?.fiscal_year_start || '1', 10) || 1))
  // Stay at 0 until settings has loaded — avoids locking in the January fallback
  // on the first render and then missing the real start month when it arrives.
  const currentFiscalYear = settings !== undefined ? getCurrentFiscalYear(fiscalStartMonth) : 0

  const [selectedYear, setSelectedYear] = useState(0)
  const [jumpValue, setJumpValue] = useState('')

  useEffect(() => {
    if (currentFiscalYear > 0 && selectedYear === 0) {
      setSelectedYear(currentFiscalYear)
    }
  }, [currentFiscalYear])

  // Forward-leaning default range: next / current / prior. A manually-jumped
  // older year is folded in so it stays selectable from the dropdown.
  const years = useMemo(() => {
    if (currentFiscalYear <= 0) return []
    const base = [currentFiscalYear + 1, currentFiscalYear, currentFiscalYear - 1]
    if (selectedYear > 0 && !base.includes(selectedYear)) {
      return [...base, selectedYear].sort((a, b) => b - a)
    }
    return base
  }, [currentFiscalYear, selectedYear])

  const jumpToYear = () => {
    const y = parseInt(jumpValue, 10)
    if (y >= 1900 && y <= 2999) {
      setSelectedYear(y)
      setJumpValue('') // clear so the box never disagrees with the <select>
    }
  }

  const { data: rows = [], isLoading } = useBudget(selectedYear, selectedYear > 0)
  const updateBudget = useUpdateBudget()

  const incomeRows = rows.filter((r) => r.account_type === 'INCOME')
  const expenseRows = rows.filter((r) => r.account_type === 'EXPENSE')

  const handleSave = (accountId: number, amount: number) => {
    updateBudget.mutate({ accountId, fiscalYear: selectedYear, amount })
  }

  const priorYear = selectedYear - 1

  return (
    <div style={{ maxWidth: '960px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.375rem', fontWeight: 700, color: '#0f172a' }}>Budget Planning</h1>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          style={{
            padding: '0.4rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '0.875rem',
            color: '#374151',
            background: 'white',
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              FY{y}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Year…"
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') jumpToYear()
          }}
          onBlur={jumpToYear}
          aria-label="Jump to fiscal year"
          style={{
            width: '92px',
            padding: '0.4rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '0.875rem',
            color: '#374151',
            background: 'white',
          }}
        />
      </div>

      {isLoading ? (
        <p style={{ color: '#6b7280' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No income or expense accounts found.</p>
      ) : (
        <>
        <SummaryPanel selectedYear={selectedYear} priorYear={priorYear} incomeRows={incomeRows} expenseRows={expenseRows} />
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH_STYLE}>Code</th>
                <th style={TH_STYLE}>Account Name</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>FY{priorYear} Actual</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>FY{priorYear} Budget</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>FY{selectedYear} Budget</th>
              </tr>
            </thead>
            <tbody>
              {incomeRows.length > 0 && (
                <>
                  <tr>
                    <td colSpan={5} style={GROUP_HEADER_STYLE}>Income</td>
                  </tr>
                  {incomeRows.map((row) => (
                    <BudgetRow key={row.account_id} row={row} fiscalYear={selectedYear} onSave={handleSave} />
                  ))}
                  <TotalsRow label="Total Income" rows={incomeRows} col="budget_amount" />
                </>
              )}
              {expenseRows.length > 0 && (
                <>
                  <tr>
                    <td colSpan={5} style={GROUP_HEADER_STYLE}>Expenses</td>
                  </tr>
                  {expenseRows.map((row) => (
                    <BudgetRow key={row.account_id} row={row} fiscalYear={selectedYear} onSave={handleSave} />
                  ))}
                  <TotalsRow label="Total Expenses" rows={expenseRows} col="budget_amount" />
                </>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      {updateBudget.isError && (
        <p style={{ color: '#dc2626', marginTop: '0.75rem', fontSize: '0.875rem' }}>
          Failed to save budget. Please try again.
        </p>
      )}
    </div>
  )
}
