import { useEffect, useMemo, useState } from 'react'

import { useAccounts } from '../api/useAccounts'
import {
  useBankTransactions,
  useBankUploads,
  useImportBankTransactions,
  useReviewBankTransaction,
} from '../api/useBankTransactions'
import { useFunds } from '../api/useFunds'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { getErrorMessage } from '../utils/errors'
import { parseStatementCsv } from '../utils/parseStatementCsv'
import ImportSetupPanel from './importCsv/ImportSetupPanel'
import type { BankImportInput, BankTransactionRow } from '@shared/contracts'
import type React from 'react'
import type { SelectOption } from '../components/ui/types'

type TabKey = 'import' | 'review'

function formatCurrency(value: number) {
  return value.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

export default function BankFeed() {
  const { addToast } = useToast()
  const { data: accounts = [] } = useAccounts()
  const { data: funds = [] } = useFunds()
  const [activeTab, setActiveTab] = useState<TabKey>('import')
  const { data: uploads = [] } = useBankUploads()
  const { data: reviewItems = [], isLoading: isLoadingReview } = useBankTransactions(
    { status: 'needs_review' },
    { enabled: activeTab === 'review' }
  )
  const importMutation = useImportBankTransactions()
  const reviewMutation = useReviewBankTransaction()
  const [reviewingId, setReviewingId] = useState<number | null>(null)

  const [bankAccountId, setBankAccountId] = useState('')
  const [fundId, setFundId] = useState('')
  const [filename, setFilename] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [rows, setRows] = useState<BankTransactionRow[]>([])
  const [importResult, setImportResult] = useState<{
    upload_id: number
    inserted: number
    skipped: number
    needs_review: number
    warnings: string[]
  } | null>(null)
  const [postImportNeedsReview, setPostImportNeedsReview] = useState(0)
  const [errors, setErrors] = useState<string[]>([])

  const activeAccounts = useMemo(() => accounts.filter((account) => account.is_active), [accounts])

  const bankAccountOptions = useMemo<SelectOption[]>(
    () => activeAccounts
      .filter((account) => account.type === 'ASSET')
      .map((account) => ({ value: account.id, label: `${account.code} — ${account.name}` })),
    [activeAccounts]
  )

  const fundOptions = useMemo<SelectOption[]>(
    () => funds.filter((fund) => fund.is_active).map((fund) => ({ value: fund.id, label: fund.name })),
    [funds]
  )

  useEffect(() => {
    if (bankAccountId !== '') return
    const defaultBankAccount = bankAccountOptions[0]
    if (!defaultBankAccount) return
    setBankAccountId(String(defaultBankAccount.value))
  }, [bankAccountId, bankAccountOptions])

  useEffect(() => {
    if (fundId !== '') return
    const defaultFund = fundOptions[0]
    if (!defaultFund) return
    setFundId(String(defaultFund.value))
  }, [fundId, fundOptions])

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setIsParsing(true)
    setParseError('')
    setErrors([])
    setImportResult(null)
    setPostImportNeedsReview(0)
    try {
      const parsed = await parseStatementCsv(file)
      setFilename(file.name)
      setParseWarnings(parsed.warnings)
      setRows(parsed.rows.map((row) => ({
        bank_posted_date: row.date,
        bank_effective_date: null,
        raw_description: row.raw_description || row.description,
        amount: row.type === 'withdrawal' ? -Math.abs(row.amount) : Math.abs(row.amount),
        bank_transaction_id: row.reference_no || null,
      })))
    } catch (err) {
      setRows([])
      setParseWarnings([])
      setParseError(getErrorMessage(err, 'Failed to parse CSV.'))
    } finally {
      setIsParsing(false)
    }
  }

  async function handleImport() {
    const nextErrors: string[] = []
    if (!bankAccountId) nextErrors.push('Bank account is required')
    if (!fundId) nextErrors.push('Fund is required')
    if (!filename) nextErrors.push('A CSV file is required')
    if (!rows.length) nextErrors.push('No parsed rows available')
    if (nextErrors.length > 0) {
      setErrors(nextErrors)
      return
    }

    setErrors([])
    try {
      const payload: BankImportInput = {
        account_id: Number(bankAccountId),
        fund_id: Number(fundId),
        filename,
        rows,
      }
      const result = await importMutation.mutateAsync(payload)
      setImportResult(result)
      setPostImportNeedsReview(result.needs_review)
      addToast(
        `Imported ${result.inserted} rows (${result.skipped} skipped, ${result.needs_review} needs review).`,
        'success'
      )
    } catch (err) {
      setErrors([getErrorMessage(err, 'Bank feed import failed.')])
    }
  }

  async function handleReview(id: number, decision: 'confirmed_new' | 'mark_as_duplicate') {
    setReviewingId(id)
    try {
      await reviewMutation.mutateAsync({ id, decision })
      addToast('Review decision saved.', 'success')
      setPostImportNeedsReview((prev) => (prev > 0 ? prev - 1 : 0))
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to save review decision.'), 'error')
    } finally {
      setReviewingId(null)
    }
  }

  const latestUpload = importResult ? uploads.find((upload) => upload.id === importResult.upload_id) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Bank Feed Queue
        </h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant={activeTab === 'import' ? 'primary' : 'secondary'} onClick={() => setActiveTab('import')}>
            Import
          </Button>
          <Button variant={activeTab === 'review' ? 'primary' : 'secondary'} onClick={() => setActiveTab('review')}>
            Review Queue
          </Button>
        </div>
      </div>

      {activeTab === 'import' && (
        <>
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <ImportSetupPanel
                bankAccountId={bankAccountId}
                fundId={fundId}
                bankAccountOptions={bankAccountOptions}
                fundOptions={fundOptions}
                isParsing={isParsing}
                parsedRowCount={rows.length}
                parseError={parseError}
                parseWarnings={parseWarnings}
                onFileChange={handleFileChange}
                onBankAccountChange={setBankAccountId}
                onFundChange={setFundId}
              />
              {rows.length > 0 && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: '#f8fafc' }}>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '0.65rem' }}>Date</th>
                        <th style={{ textAlign: 'left', padding: '0.65rem' }}>Description</th>
                        <th style={{ textAlign: 'right', padding: '0.65rem' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 20).map((row, index) => (
                        <tr key={`${row.bank_posted_date}-${row.amount}-${index}`} style={{ borderTop: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.65rem' }}>{row.bank_posted_date}</td>
                          <td style={{ padding: '0.65rem' }}>{row.raw_description}</td>
                          <td style={{ padding: '0.65rem', textAlign: 'right' }}>{formatCurrency(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {rows.length > 20 && (
                <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                  Showing first 20 rows of {rows.length}.
                </div>
              )}
              {errors.length > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem 1rem' }}>
                  {errors.map((error, index) => (
                    <div key={index} style={{ color: '#b91c1c', fontSize: '0.82rem' }}>• {error}</div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button onClick={handleImport} isLoading={importMutation.isPending} disabled={!rows.length || isParsing}>
                  Confirm Import
                </Button>
              </div>
            </div>
          </Card>

          {importResult && (
            <Card>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>
                  Import Summary
                </div>
                <div style={{ fontSize: '0.9rem', color: '#334155' }}>
                  Upload #{importResult.upload_id}: {importResult.inserted} inserted, {importResult.skipped} skipped, {importResult.needs_review} needs review.
                </div>
                {latestUpload && (
                  <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                    {latestUpload.filename} • {latestUpload.account_name} • {latestUpload.fund_name}
                  </div>
                )}
                {postImportNeedsReview > 0 && (
                  <div style={{ fontSize: '0.82rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                    {postImportNeedsReview} row(s) from this upload require review. Switch to the Review Queue tab.
                  </div>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      {activeTab === 'review' && (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>
              Needs Review ({reviewItems.length})
            </div>
            {isLoadingReview && (
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Loading review queue...</div>
            )}
            {!isLoadingReview && reviewItems.length === 0 && (
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>No items need review.</div>
            )}
            {reviewItems.map((item) => (
              <div key={item.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.8rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                  <div style={{ background: '#f8fafc', borderRadius: '6px', padding: '0.65rem' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.4rem' }}>New row</div>
                    <div style={{ fontSize: '0.85rem', color: '#0f172a' }}>{item.bank_posted_date}</div>
                    <div style={{ fontSize: '0.85rem', color: '#334155' }}>{item.raw_description}</div>
                    <div style={{ fontSize: '0.85rem', color: '#0f172a' }}>{formatCurrency(item.amount)}</div>
                  </div>
                  <div style={{ background: '#fff7ed', borderRadius: '6px', padding: '0.65rem' }}>
                    <div style={{ fontSize: '0.75rem', color: '#9a3412', marginBottom: '0.4rem' }}>Conflict row</div>
                    {item.conflict ? (
                      <>
                        <div style={{ fontSize: '0.85rem', color: '#7c2d12' }}>{item.conflict.bank_posted_date}</div>
                        <div style={{ fontSize: '0.85rem', color: '#9a3412' }}>{item.conflict.raw_description}</div>
                        <div style={{ fontSize: '0.85rem', color: '#7c2d12' }}>{formatCurrency(item.conflict.amount)}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: '0.85rem', color: '#9a3412' }}>No conflict details available</div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.65rem' }}>
                  <Button
                    variant="secondary"
                    onClick={() => handleReview(item.id, 'mark_as_duplicate')}
                    isLoading={reviewMutation.isPending && reviewingId === item.id}
                  >
                    Mark Duplicate
                  </Button>
                  <Button
                    onClick={() => handleReview(item.id, 'confirmed_new')}
                    isLoading={reviewMutation.isPending && reviewingId === item.id}
                  >
                    Confirm New
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
