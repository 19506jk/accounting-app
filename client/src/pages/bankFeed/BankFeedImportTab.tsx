import { useEffect, useState } from 'react'

import { useBankUploads, useImportBankTransactions } from '../../api/useBankTransactions'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { useToast } from '../../components/ui/Toast'
import { getErrorMessage } from '../../utils/errors'
import { parseStatementCsv } from '../../utils/parseStatementCsv'
import ImportSetupPanel from '../importCsv/ImportSetupPanel'
import { formatCurrency } from './bankFeedHelpers'
import type { BankImportInput, BankTransactionRow } from '@shared/contracts'
import type React from 'react'
import type { SelectOption } from '../../components/ui/types'

interface BankFeedImportTabProps {
  isActive: boolean
  bankAccountOptions: SelectOption[]
  fundOptions: SelectOption[]
  postImportNeedsReview: number
  setPostImportNeedsReview: React.Dispatch<React.SetStateAction<number>>
}

export default function BankFeedImportTab({
  isActive,
  bankAccountOptions,
  fundOptions,
  postImportNeedsReview,
  setPostImportNeedsReview,
}: BankFeedImportTabProps) {
  const { addToast } = useToast()
  const { data: uploads = [] } = useBankUploads({ enabled: isActive })
  const importMutation = useImportBankTransactions()
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
  const [errors, setErrors] = useState<string[]>([])

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
      setRows(parsed.rows.map((row, i) => {
        const meta = parsed.metadata[i]
        return {
          bank_posted_date: row.date,
          bank_effective_date: null,
          raw_description: row.raw_description || row.description,
          amount: row.type === 'withdrawal' ? -Math.abs(row.amount) : Math.abs(row.amount),
          bank_transaction_id: row.reference_no || null,
          sender_name: meta?.sender || null,
          sender_email: meta?.from || null,
          bank_description_2: meta?.description_2 || null,
        }
      }))
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
        `Imported ${result.inserted - result.needs_review} rows, ${result.needs_review} flagged for review (${result.skipped} skipped).`,
        'success'
      )
    } catch (err) {
      setErrors([getErrorMessage(err, 'Bank feed import failed.')])
    }
  }

  const latestUpload = importResult ? uploads.find((upload) => upload.id === importResult.upload_id) : null

  return (
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
  )
}
