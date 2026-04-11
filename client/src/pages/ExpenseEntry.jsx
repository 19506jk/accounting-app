import { useEffect, useMemo, useRef, useState } from 'react'
import Decimal from 'decimal.js'

import { useCreateTransaction } from '../api/useTransactions'
import { useAccounts } from '../api/useAccounts'
import { useFunds } from '../api/useFunds'
import { useContacts } from '../api/useContacts'
import { useTaxRates } from '../api/useTaxRates'
import { useToast } from '../components/ui/Toast'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Combobox from '../components/ui/Combobox'
import ExpenseBreakdown from '../components/ExpenseBreakdown'
import { getChurchToday } from '../utils/date'

const dec = (value) => new Decimal(value || 0)
const fmt = (value) => '$' + Number(value || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 })
const ROUNDING_ACCOUNT_CODE = '59999'
const MAX_ROUNDING_ADJUSTMENT = new Decimal('0.10')
const EPSILON = new Decimal('0.001')

function createEmptyLine(id) {
  return {
    id,
    expense_account_id: '',
    tax_rate_id: '',
    amount: '',
    rounding_adjustment: '',
    description: '',
  }
}

export default function ExpenseEntry() {
  const { addToast } = useToast()
  const { data: accounts } = useAccounts()
  const { data: funds } = useFunds()
  const { data: contacts } = useContacts({ type: 'PAYEE' })
  const { data: taxRates = [] } = useTaxRates({ activeOnly: true })
  const createTx = useCreateTransaction()

  const [header, setHeader] = useState({
    date: getChurchToday(),
    reference_no: '',
    payee_id: '',
    description: '',
    total_amount: '',
    payment_account_id: '',
    fund_id: '',
  })

  const lineIdRef = useRef(2)
  const [lines, setLines] = useState([createEmptyLine('line-1')])
  const [errors, setErrors] = useState([])

  const payeeOptions = useMemo(
    () => (contacts || []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })),
    [contacts]
  )

  const expenseAccounts = useMemo(
    () => (accounts || [])
      .filter((a) => a.type === 'EXPENSE' && a.is_active)
      .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [accounts]
  )

  const paymentAccounts = useMemo(
    () => (accounts || [])
      .filter((a) => a.type === 'ASSET' && a.is_active)
      .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [accounts]
  )

  const fundOptions = useMemo(
    () => (funds || []).filter((f) => f.is_active).map((f) => ({ value: f.id, label: f.name })),
    [funds]
  )

  const taxRateOptions = [
    { value: '', label: 'Exempt' },
    ...taxRates.map((tr) => ({ value: String(tr.id), label: `${tr.name} (${(tr.rate * 100).toFixed(2)}%)` })),
  ]

  const taxRateMap = useMemo(() => Object.fromEntries(taxRates.map((tr) => [String(tr.id), tr])), [taxRates])
  const accountMap = useMemo(() => Object.fromEntries((accounts || []).map((a) => [a.id, a])), [accounts])

  const roundingAccount = useMemo(
    () => (accounts || []).find((a) => a.code === ROUNDING_ACCOUNT_CODE && a.is_active),
    [accounts]
  )

  useEffect(() => {
    if (!header.payment_account_id && paymentAccounts.length > 0) {
      setHeader((prev) => ({ ...prev, payment_account_id: paymentAccounts[0].value }))
    }
    if (!header.fund_id && fundOptions.length > 0) {
      setHeader((prev) => ({ ...prev, fund_id: fundOptions[0].value }))
    }
  }, [paymentAccounts, fundOptions, header.payment_account_id, header.fund_id])

  const calculatedRows = useMemo(() => {
    return lines.map((line) => {
      const preTax = dec(line.amount)
      const rounding = dec(line.rounding_adjustment)
      const rate = line.tax_rate_id ? taxRateMap[line.tax_rate_id]?.rate : 0
      const tax = rate ? preTax.times(dec(rate)).toDecimalPlaces(2) : dec(0)
      const gross = preTax.plus(tax).plus(rounding).toDecimalPlaces(2)
      return { preTax, rounding, tax, gross }
    })
  }, [lines, taxRateMap])

  const expenseLineTotals = useMemo(() => {
    return calculatedRows.map((row, index) => ({
      gross: Number(row.gross),
      net: Number(row.preTax),
      tax: Number(row.tax),
      taxName: lines[index].tax_rate_id ? taxRateMap[lines[index].tax_rate_id]?.name ?? null : null,
      rounding: Number(row.rounding),
    }))
  }, [calculatedRows, lines, taxRateMap])

  const totals = useMemo(() => {
    const preTax = calculatedRows.reduce((sum, row) => sum.plus(row.preTax), dec(0))
    const tax = calculatedRows.reduce((sum, row) => sum.plus(row.tax), dec(0))
    const rounding = calculatedRows.reduce((sum, row) => sum.plus(row.rounding), dec(0))
    const computed = calculatedRows.reduce((sum, row) => sum.plus(row.gross), dec(0)).toDecimalPlaces(2)
    const target = dec(header.total_amount)
    const remaining = target.minus(computed).toDecimalPlaces(2)

    return {
      preTax: preTax.toDecimalPlaces(2),
      tax: tax.toDecimalPlaces(2),
      rounding: rounding.toDecimalPlaces(2),
      computed,
      target: target.toDecimalPlaces(2),
      remaining,
      matchesTotal: remaining.abs().lte(EPSILON) && target.gt(0),
    }
  }, [calculatedRows, header.total_amount])

  function setLine(index, key, value) {
    setLines((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [key]: value }
      return next
    })
  }

  function addLine() {
    const previous = lines[lines.length - 1] || createEmptyLine('line-fallback')
    setLines((prev) => [
      ...prev,
      {
        ...createEmptyLine(`line-${lineIdRef.current++}`),
        expense_account_id: previous.expense_account_id,
        tax_rate_id: previous.tax_rate_id,
      },
    ])
  }

  function removeLine(index) {
    if (lines.length <= 1) return
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  const validationErrors = useMemo(() => {
    const nextErrors = []

    if (!header.payee_id) nextErrors.push('Payee is required')
    if (!header.date) nextErrors.push('Date is required')
    if (!header.description.trim()) nextErrors.push('Description is required')
    if (!header.total_amount || dec(header.total_amount).lte(0)) nextErrors.push('Total amount must be greater than zero')
    if (!header.payment_account_id) nextErrors.push('Paid from account is required')
    if (!header.fund_id) nextErrors.push('Fund is required')

    if (!Array.isArray(lines) || lines.length === 0) {
      nextErrors.push('At least one expense breakdown row is required')
      return nextErrors
    }

    lines.forEach((line, index) => {
      const row = index + 1
      const preTax = dec(line.amount)
      const rounding = dec(line.rounding_adjustment)
      const taxRate = line.tax_rate_id ? taxRateMap[line.tax_rate_id] : null

      if (!line.expense_account_id) nextErrors.push(`Row ${row}: Expense account is required`)
      if (!line.amount || preTax.lte(0)) nextErrors.push(`Row ${row}: Pre-tax amount must be greater than zero`)
      if (preTax.decimalPlaces() > 2) nextErrors.push(`Row ${row}: Pre-tax amount must have at most 2 decimal places`)
      if (rounding.decimalPlaces() > 2) nextErrors.push(`Row ${row}: Rounding adjustment must have at most 2 decimal places`)
      if (rounding.abs().gt(MAX_ROUNDING_ADJUSTMENT)) {
        nextErrors.push(`Row ${row}: Rounding adjustment cannot exceed ${MAX_ROUNDING_ADJUSTMENT.toFixed(2)} in absolute value`)
      }

      const expenseAccount = line.expense_account_id ? accountMap[Number(line.expense_account_id)] : null
      if (expenseAccount && expenseAccount.type !== 'EXPENSE') {
        nextErrors.push(`Row ${row}: Expense account must be of type EXPENSE`)
      }

      if (taxRate) {
        if (!taxRate.recoverable_account_id) {
          nextErrors.push(`Row ${row}: Selected tax type has no recoverable account configured`)
        } else {
          const recoverable = accountMap[Number(taxRate.recoverable_account_id)]
          if (!recoverable || !recoverable.is_active) {
            nextErrors.push(`Row ${row}: Recoverable account for selected tax type is missing or inactive`)
          }
        }
      }

      if (!rounding.isZero() && !roundingAccount) {
        nextErrors.push(`Row ${row}: Rounding account ${ROUNDING_ACCOUNT_CODE} is missing or inactive`)
      }
    })

    if (!totals.matchesTotal) {
      nextErrors.push(`Total mismatch: Entered ${fmt(totals.target.toFixed(2))} but computed ${fmt(totals.computed.toFixed(2))}`)
    }

    if (totals.computed.lte(0)) {
      nextErrors.push('Computed expense total must be greater than zero')
    }

    return nextErrors
  }, [header, lines, taxRateMap, accountMap, roundingAccount, totals])

  const isFormSavable = validationErrors.length === 0

  async function handleSubmit() {
    const nextErrors = validationErrors
    setErrors(nextErrors)
    if (nextErrors.length > 0) return

    const fundId = Number(header.fund_id)
    const payeeId = Number(header.payee_id)
    const paymentAccountId = Number(header.payment_account_id)
    const nextReferenceNo = header.reference_no.trim()

    const lineEntries = []

    lines.forEach((line, index) => {
      const rowTotals = calculatedRows[index]
      const preTax = rowTotals.preTax.toDecimalPlaces(2)
      const rounding = rowTotals.rounding.toDecimalPlaces(2)
      const tax = rowTotals.tax.toDecimalPlaces(2)
      const taxRate = line.tax_rate_id ? taxRateMap[line.tax_rate_id] : null

      lineEntries.push({
        account_id: Number(line.expense_account_id),
        fund_id: fundId,
        debit: parseFloat(preTax.toFixed(2)),
        credit: 0,
        contact_id: payeeId,
        memo: line.description?.trim() || undefined,
      })

      if (taxRate && tax.gt(0)) {
        lineEntries.push({
          account_id: Number(taxRate.recoverable_account_id),
          fund_id: fundId,
          debit: parseFloat(tax.toFixed(2)),
          credit: 0,
          contact_id: payeeId,
          memo: `${taxRate.name} on ${line.description?.trim() || header.description.trim()}`,
        })
      }

      if (!rounding.isZero() && roundingAccount) {
        const positive = rounding.gt(0)
        lineEntries.push({
          account_id: roundingAccount.id,
          fund_id: fundId,
          debit: positive ? parseFloat(rounding.toFixed(2)) : 0,
          credit: positive ? 0 : parseFloat(rounding.abs().toFixed(2)),
          contact_id: payeeId,
          memo: `Rounding adjustment${line.description?.trim() ? ` - ${line.description.trim()}` : ''}`,
        })
      }
    })

    const paymentEntry = {
      account_id: paymentAccountId,
      fund_id: fundId,
      debit: 0,
      credit: parseFloat(totals.computed.toFixed(2)),
      memo: header.description.trim(),
    }

    const payload = {
      date: header.date,
      description: header.description.trim(),
      reference_no: nextReferenceNo || null,
      entries: [...lineEntries, paymentEntry],
    }

    try {
      await createTx.mutateAsync(payload)
      addToast('Expense recorded successfully.', 'success')
      setErrors([])
      setHeader({
        date: getChurchToday(),
        reference_no: '',
        payee_id: '',
        description: '',
        total_amount: '',
        payment_account_id: '',
        fund_id: '',
      })
      setLines([createEmptyLine(`line-${lineIdRef.current++}`)])
    } catch (err) {
      const apiErrors = err.response?.data?.errors || [err.response?.data?.error || 'Failed to record expense.']
      setErrors(apiErrors)
    }
  }

  return (
    <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '0 1rem 3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Record Expense
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <Input
          label="Date"
          required
          type="date"
          value={header.date}
          onChange={(event) => setHeader((prev) => ({ ...prev, date: event.target.value }))}
        />

        <Input
          label="Reference No"
          value={header.reference_no}
          onChange={(event) => setHeader((prev) => ({ ...prev, reference_no: event.target.value }))}
          placeholder="EXP-001"
        />

        <Combobox
          label="Payee"
          required
          options={payeeOptions}
          value={header.payee_id}
          onChange={(value) => setHeader((prev) => ({ ...prev, payee_id: value }))}
          placeholder="Select payee..."
        />

        <Combobox
          label="Paid From"
          required
          options={paymentAccounts}
          value={header.payment_account_id}
          onChange={(value) => setHeader((prev) => ({ ...prev, payment_account_id: value }))}
          placeholder="Select account..."
        />

        <Combobox
          label="Fund"
          required
          options={fundOptions}
          value={header.fund_id}
          onChange={(value) => setHeader((prev) => ({ ...prev, fund_id: value }))}
          placeholder="Select fund..."
        />

        <Input
          label="Total Amount"
          required
          type="number"
          min="0"
          step="0.01"
          value={header.total_amount}
          onChange={(event) => setHeader((prev) => ({ ...prev, total_amount: event.target.value }))}
          placeholder="0.00"
          style={{ fontSize: '1.05rem', fontWeight: 600, color: '#15803d' }}
        />
      </div>

      <Input
        label="Description"
        required
        value={header.description}
        onChange={(event) => setHeader((prev) => ({ ...prev, description: event.target.value }))}
        style={{ marginBottom: '2rem', maxWidth: '760px' }}
        placeholder="Expense description"
      />

      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
        Expense Breakdown
      </div>

      <ExpenseBreakdown
        lines={lines}
        lineTotals={expenseLineTotals}
        expenseAccountOptions={expenseAccounts}
        taxRateOptions={taxRateOptions}
        onChange={setLine}
        onRemove={removeLine}
        showGrossColumn
        minWidth={1080}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <Button variant="secondary" size="sm" onClick={addLine}>+ Add Line</Button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.9rem', flexWrap: 'wrap' }}>
          <span style={{ color: '#6b7280' }}>Pre-tax: <strong style={{ color: '#1e293b' }}>{fmt(totals.preTax.toFixed(2))}</strong></span>
          <span style={{ color: '#6b7280' }}>Tax: <strong style={{ color: '#1e293b' }}>{fmt(totals.tax.toFixed(2))}</strong></span>
          <span style={{ color: '#6b7280' }}>Rounding: <strong style={{ color: '#1e293b' }}>{fmt(totals.rounding.toFixed(2))}</strong></span>
          <span style={{ color: '#6b7280' }}>Computed Total: <strong style={{ color: '#1e293b' }}>{fmt(totals.computed.toFixed(2))}</strong></span>
          <span style={{ color: totals.matchesTotal ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
            Remaining: {fmt(totals.remaining.toFixed(2))}
          </span>
        </div>
      </div>

      {errors.length > 0 && (
        <div style={{ marginTop: '1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem 1rem' }}>
          {errors.map((error, index) => (
            <div key={index} style={{ fontSize: '0.8rem', color: '#dc2626' }}>• {error}</div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={handleSubmit} isLoading={createTx.isPending} disabled={!isFormSavable}>
          Save Expense
        </Button>
      </div>
    </div>
  )
}
