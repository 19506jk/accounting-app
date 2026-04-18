import { useEffect, useMemo, useState } from 'react'
import client from '../api/client'
import Button from '../components/ui/Button'
import { getErrorMessage } from '../utils/errors'
import type React from 'react'
import type { HardCloseInvestigateResponse } from '@shared/contracts'

interface HardCloseWizardProps {
  open: boolean
  onClose?: () => void
  onSuccess?: () => void
}

const fmt = (n: number | string | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 })

function ChecklistItem({ passed, children }: { passed: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0' }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.35rem',
        height: '1.35rem',
        borderRadius: '999px',
        fontSize: '0.7rem',
        fontWeight: 700,
        color: passed ? '#166534' : '#991b1b',
        background: passed ? '#dcfce7' : '#fee2e2',
      }}>
        {passed ? 'OK' : 'X'}
      </span>
      <span>{children}</span>
    </div>
  )
}

function StepTabs({ step }: { step: number }) {
  const items = ['Pre-flight', 'Preview', 'Confirm']
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
      {items.map((label, index) => {
        const active = step === index + 1
        return (
          <span key={label} style={{
            padding: '0.35rem 0.7rem',
            borderRadius: '999px',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: active ? '#1d4ed8' : '#6b7280',
            background: active ? '#dbeafe' : '#f3f4f6',
          }}>
            {index + 1}. {label}
          </span>
        )
      })}
    </div>
  )
}

export default function HardCloseWizard({ open, onClose, onSuccess }: HardCloseWizardProps) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<HardCloseInvestigateResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [error, setError] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStep(1)
    setData(null)
    setError('')
    setAcknowledged(false)
    setIsLoading(true)

    client.post<HardCloseInvestigateResponse>('/fiscal-periods/investigate')
      .then(({ data: response }) => {
        if (!cancelled) setData(response)
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, 'Unexpected error'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [open])

  const preflightPasses = useMemo(() => {
    const preflight = data?.preflight
    if (!preflight) return false
    return preflight.trial_balance_plugs
      && preflight.per_fund_balanced
      && preflight.all_asset_accounts_reconciled
      && preflight.no_unmapped_funds
  }, [data])

  const totals = useMemo(() => {
    const lines = data?.pro_forma_lines || []
    return lines.reduce((sum, line) => ({
      debit: sum.debit + Number(line.debit || 0),
      credit: sum.credit + Number(line.credit || 0),
    }), { debit: 0, credit: 0 })
  }, [data])

  if (!open) return null

  async function executeClose() {
    setIsExecuting(true)
    setError('')
    try {
      await client.post('/fiscal-periods/close', { acknowledged: true })
      onSuccess?.()
      onClose?.()
    } catch (err) {
      setError(getErrorMessage(err, 'Unexpected error'))
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      background: 'rgba(15, 23, 42, 0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        width: 'min(920px, 100%)',
        maxHeight: '90vh',
        overflow: 'auto',
        background: 'white',
        borderRadius: '14px',
        boxShadow: '0 24px 80px rgba(15, 23, 42, 0.28)',
      }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#111827' }}>Hard Close Fiscal Year</h2>
              <div style={{ marginTop: '0.3rem', color: '#6b7280', fontSize: '0.85rem' }}>
                {data ? `Closing FY${data.fiscal_year}: ${data.period_start} to ${data.period_end}` : 'Preparing close investigation'}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>

        <div style={{ padding: '1.25rem 1.5rem' }}>
          <StepTabs step={step} />

          {error && (
            <div style={{
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              borderRadius: '8px',
              padding: '0.75rem 0.9rem',
              marginBottom: '1rem',
              fontSize: '0.85rem',
            }}>
              {error}
            </div>
          )}

          {isLoading && <div style={{ color: '#6b7280', padding: '1rem 0' }}>Checking close readiness...</div>}

          {!isLoading && data && step === 1 && (
            <div>
              <ChecklistItem passed={data.preflight.trial_balance_plugs}>Trial balance is in balance across the period</ChecklistItem>
              <ChecklistItem passed={data.preflight.per_fund_balanced}>All funds individually balance</ChecklistItem>
              <ChecklistItem passed={data.preflight.all_asset_accounts_reconciled}>All asset accounts reconciled through {data.period_end}</ChecklistItem>
              {!data.preflight.all_asset_accounts_reconciled && data.preflight.unreconciled_accounts.length > 0 && (
                <div style={{ marginTop: '0.35rem', marginBottom: '0.55rem', marginLeft: '1.95rem', fontSize: '0.82rem', color: '#991b1b' }}>
                  {data.preflight.unreconciled_accounts.map((account) => (
                    <div key={account.account_id} style={{ marginBottom: '0.35rem' }}>
                      <div>{account.account_code} - {account.account_name}</div>
                      <div style={{ color: '#7f1d1d' }}>
                        Latest closed: {account.latest_closed_statement_date || 'none'} | Required through: {account.required_through_date}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <ChecklistItem passed={data.preflight.no_unmapped_funds}>All funds have a net-asset account mapping</ChecklistItem>

              {!data.preflight.no_unmapped_funds && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#991b1b' }}>
                  Fund mapping must be fixed in <a href="/accounts" style={{ color: '#1d4ed8' }}>Chart of Accounts</a> before closing.
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button disabled={!preflightPasses} onClick={() => setStep(2)}>Continue</Button>
              </div>
            </div>
          )}

          {!isLoading && data && step === 2 && (
            <div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#6b7280' }}>
                      {['Account', 'Type', 'Fund', 'Debit', 'Credit'].map((header) => (
                        <th key={header} style={{ padding: '0.55rem 0.65rem', textAlign: ['Debit', 'Credit'].includes(header) ? 'right' : 'left' }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.pro_forma_lines || []).map((line, index) => (
                      <tr key={`${line.account_id}-${line.fund_id}-${index}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '0.55rem 0.65rem' }}>{line.account_code} - {line.account_name}</td>
                        <td style={{ padding: '0.55rem 0.65rem', color: '#6b7280' }}>{line.account_type}</td>
                        <td style={{ padding: '0.55rem 0.65rem', color: '#6b7280' }}>{line.fund_name}</td>
                        <td style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>{line.debit > 0 ? fmt(line.debit) : ''}</td>
                        <td style={{ padding: '0.55rem 0.65rem', textAlign: 'right' }}>{line.credit > 0 ? fmt(line.credit) : ''}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid #1e293b', fontWeight: 700 }}>
                      <td colSpan={3} style={{ padding: '0.65rem' }}>Totals</td>
                      <td style={{ padding: '0.65rem', textAlign: 'right' }}>{fmt(totals.debit)}</td>
                      <td style={{ padding: '0.65rem', textAlign: 'right' }}>{fmt(totals.credit)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.25rem' }}>
                <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={() => setStep(3)}>Confirm & Execute Close</Button>
              </div>
            </div>
          )}

          {!isLoading && data && step === 3 && (
            <div>
              <div style={{
                border: '1px solid #fde68a',
                background: '#fffbeb',
                color: '#78350f',
                borderRadius: '8px',
                padding: '0.75rem 0.9rem',
                marginBottom: '1rem',
              }}>
                This posts permanent journal entries and locks FY{data.fiscal_year} through {data.period_end}.
              </div>

              <label style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                I confirm this is correct and authorized.
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.25rem' }}>
                <Button variant="secondary" onClick={() => setStep(2)} disabled={isExecuting}>Back</Button>
                <Button variant="danger" disabled={!acknowledged} isLoading={isExecuting} onClick={executeClose}>
                  Execute Hard Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
