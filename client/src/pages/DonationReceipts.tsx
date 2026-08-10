import { useEffect, useMemo, useState } from 'react'
import {
  useDonationReceiptAccounts,
  useDonationReceiptTemplate,
  useGenerateDonationReceiptPdf,
  usePreviewDonationReceipt,
  useSaveDonationReceiptTemplate,
} from '../api/useDonationReceipts'
import { useSettings } from '../api/useSettings'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import { getErrorMessage } from '../utils/errors'
import { getCurrentFiscalYear } from '../utils/fiscalYear'

type ReceiptStatusType = 'success' | 'warning' | 'error' | null

const fmt = (n: number | string | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 })

const previewStyles = `
  .receipt-preview {
    padding: 2.5rem;
    color: #243247;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 0.875rem;
    line-height: 1.5;
    background: white;
  }
  .receipt-preview h1 {
    margin: 0.15rem 0 0.7rem;
    color: #173b57;
    font-size: 1.65rem;
    line-height: 1.2;
  }
  .receipt-preview h2 {
    margin: 0.15rem 0 0.45rem;
    color: #173b57;
    font-size: 1.4rem;
    line-height: 1.2;
  }
  .receipt-preview h3 {
    margin: 0.85rem 0 0.5rem;
    font-size: 1rem;
    line-height: 1.3;
  }
  .receipt-preview p {
    margin: 0 0 0.7rem;
  }
  .receipt-preview ul,
  .receipt-preview ol {
    margin: 0 0 0.75rem 1.4rem;
    padding: 0;
  }
  .receipt-preview li {
    margin-bottom: 0.3rem;
  }
  .receipt-preview table {
    width: 100%;
    overflow: hidden;
    border-collapse: collapse;
    margin: 0.15rem 0 0.9rem;
    border: 1px solid #b9c8d4;
    border-radius: 4px;
    font-size: 0.82rem;
  }
  .receipt-preview th,
  .receipt-preview td {
    border: 1px solid #d8e1e8;
    padding: 0.65rem 0.7rem;
    text-align: left;
  }
  .receipt-preview th {
    background: #e9f0f5;
  }
  .receipt-preview blockquote {
    margin: 0 0 0.75rem;
    padding-left: 0.75rem;
    border-left: 3px solid #9ca3af;
  }
  .receipt-preview hr {
    border: 0;
    border-top: 2px solid #2f6f89;
    margin: 0.85rem 0;
  }
  .receipt-preview code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.82rem;
  }
  .receipt-preview a {
    color: #1d4ed8;
    text-decoration: underline;
  }
  /* Trusted signer signatures carry their width/height attributes; only
     non-dimensional styling is added here. */
  .receipt-preview img {
    object-fit: contain;
  }
`

function base64ToBlob(base64: string, type: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new Blob([bytes], { type })
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function ReceiptHtmlPreview({ html }: { html: string }) {
  const srcdoc = useMemo(() => (
    `<!DOCTYPE html><html><head><style>${previewStyles}</style></head><body><div class="receipt-preview">${html}</div></body></html>`
  ), [html])
  return (
    <iframe
      title="Receipt preview"
      sandbox=""
      srcDoc={srcdoc}
      style={{ width: '100%', height: '520px', border: 'none', background: 'white', display: 'block' }}
    />
  )
}

export default function DonationReceipts() {
  const { data: settings } = useSettings()
  const fiscalStartMonth = Math.max(1, Math.min(12, parseInt(settings?.fiscal_year_start || '1', 10) || 1))
  const currentFiscalYear = getCurrentFiscalYear(fiscalStartMonth)

  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear)
  const [accountIds, setAccountIds] = useState<number[]>([])
  const [htmlBody, setHtmlBody] = useState('')
  const [status, setStatus] = useState<{ message: string; type: ReceiptStatusType }>({ message: '', type: null })

  useEffect(() => {
    setFiscalYear(currentFiscalYear)
  }, [currentFiscalYear])

  const years = useMemo(() => (
    Array.from({ length: 6 }, (_, index) => currentFiscalYear - index)
  ), [currentFiscalYear])

  const accountsQuery = useDonationReceiptAccounts(fiscalYear, Boolean(fiscalYear))
  const templateQuery = useDonationReceiptTemplate()
  const saveTemplate = useSaveDonationReceiptTemplate()
  const previewReceipt = usePreviewDonationReceipt()
  const generateReceiptPdf = useGenerateDonationReceiptPdf()

  useEffect(() => {
    if (templateQuery.data?.template?.html_body) {
      setHtmlBody(templateQuery.data.template.html_body)
    }
  }, [templateQuery.data?.template?.html_body])

  const accounts = accountsQuery.data?.accounts || []
  const selectedAccounts = new Set(accountIds)
  const numericAccountIds = accountIds
  const accountOptions = accounts.map((account) => ({
    value: account.id,
    label: `${account.code} — ${account.name} (${fmt(account.total)})`,
  }))
  const periodLabel = accountsQuery.data
    ? `${accountsQuery.data.period_start} to ${accountsQuery.data.period_end}`
    : ''

  function handleSelectAll() {
    setAccountIds(accounts.map((account) => account.id))
  }

  function handleClearAccounts() {
    setAccountIds([])
  }

  async function handleSaveTemplate() {
    setStatus({ message: '', type: null })
    try {
      await saveTemplate.mutateAsync({ html_body: htmlBody })
      setStatus({ message: 'Template saved.', type: 'success' })
    } catch (error) {
      setStatus({ message: getErrorMessage(error, 'Request failed'), type: 'error' })
    }
  }

  async function handlePreview() {
    setStatus({ message: '', type: null })
    try {
      await previewReceipt.mutateAsync({
        fiscal_year: fiscalYear,
        account_ids: numericAccountIds,
        html_body: htmlBody,
      })
    } catch (error) {
      setStatus({ message: getErrorMessage(error, 'Request failed'), type: 'error' })
    }
  }

  async function handleGenerate() {
    setStatus({ message: '', type: null })
    try {
      const result = await generateReceiptPdf.mutateAsync({
        fiscal_year: fiscalYear,
        account_ids: numericAccountIds,
        html_body: htmlBody,
      })
      downloadBlob(base64ToBlob(result.pdf_base64, 'application/pdf'), result.filename)
      const warnings = result.meta?.warnings || []
      setStatus({
        message: warnings.length
          ? `Downloaded ${result.meta?.donor_count || 0} receipt(s). Warnings: ${warnings.join(' ')}`
          : `Downloaded ${result.meta?.donor_count || 0} receipt(s).`,
        type: warnings.length ? 'warning' : 'success',
      })
    } catch (error) {
      setStatus({ message: getErrorMessage(error, 'Request failed'), type: 'error' })
    }
  }

  const previewHtml = previewReceipt.data?.html || null
  const hasPreviewResult = Boolean(previewReceipt.data)
  const hasNoDonorResult = hasPreviewResult && previewHtml === null

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', marginBottom: '1.5rem' }}>
        Donation Receipts
      </h1>

      <Card style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '1rem', alignItems: 'end' }}>
          <Select
            label="Fiscal Year"
            value={fiscalYear}
            onChange={(event) => {
              setFiscalYear(Number(event.target.value))
              setAccountIds([])
              previewReceipt.reset()
            }}
            options={years.map((year) => ({ value: year, label: `FY ${year}` }))}
          />
          <div style={{ color: '#6b7280', fontSize: '0.85rem', paddingBottom: '0.45rem' }}>
            {periodLabel ? `Receipt period: ${periodLabel}` : 'Loading fiscal-year period...'}
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'end', marginBottom: '0.75rem' }}>
          <Select
            multiple
            size={6}
            label="Income Accounts"
            options={accountOptions}
            value={accountIds.map(String)}
            onChange={(event) => {
              setAccountIds(Array.from(event.currentTarget.selectedOptions, (option) => Number(option.value)))
              previewReceipt.reset()
            }}
            disabled={accountsQuery.isLoading}
            style={{ flex: 1 }}
          />
          <Button variant="secondary" onClick={handleSelectAll} disabled={!accounts.length}>
            Select All
          </Button>
          <Button variant="secondary" onClick={handleClearAccounts} disabled={!accountIds.length}>
            Clear
          </Button>
        </div>
        <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
          {accountIds.length} of {accounts.length} income account{accounts.length === 1 ? '' : 's'} selected.
        </div>
        {accountIds.length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            {accounts.filter((account) => selectedAccounts.has(account.id)).map((account) => (
              <span key={account.id} style={{
                border: '1px solid #dbeafe',
                background: '#eff6ff',
                color: '#1d4ed8',
                borderRadius: '999px',
                padding: '0.25rem 0.6rem',
                fontSize: '0.78rem',
              }}>
                {account.code} {account.name}
              </span>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 0.9fr)', gap: '1.25rem' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>HTML Template</h2>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.2rem' }}>
                Use the variables listed below. Unknown variables are rejected by the server, and HTML is sanitized — only text-align styles, safe links, and basic formatting are kept.
              </div>
            </div>
            <Button onClick={handleSaveTemplate} isLoading={saveTemplate.isPending} disabled={!htmlBody.trim()}>
              Save Template
            </Button>
          </div>

          <textarea
            value={htmlBody}
            onChange={(event) => {
              setHtmlBody(event.target.value)
              previewReceipt.reset()
            }}
            style={{
              width: '100%',
              minHeight: '440px',
              boxSizing: 'border-box',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '0.85rem',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '0.82rem',
              lineHeight: 1.5,
              resize: 'vertical',
            }}
          />

          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', marginBottom: '0.4rem' }}>
              Variables
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {(templateQuery.data?.variables || []).map((variable) => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => setHtmlBody((body) => `${body}${body.endsWith('\n') || !body ? '' : ' '}{{${variable}}}`)}
                  style={{
                    border: '1px solid #e5e7eb',
                    background: '#f9fafb',
                    borderRadius: '999px',
                    padding: '0.22rem 0.5rem',
                    fontSize: '0.72rem',
                    color: '#374151',
                    cursor: 'pointer',
                  }}
                >
                  {`{{${variable}}}`}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Preview</h2>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.2rem' }}>
                Preview uses the first real donor found for the selected filters.
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={handlePreview}
              isLoading={previewReceipt.isPending}
              disabled={!numericAccountIds.length || !htmlBody.trim()}
            >
              Preview
            </Button>
          </div>

          {(previewReceipt.data?.warnings?.length ?? 0) > 0 && (
            <div style={{
              border: '1px solid #fde68a',
              background: '#fffbeb',
              color: '#78350f',
              borderRadius: '8px',
              padding: '0.75rem',
              fontSize: '0.8rem',
              marginBottom: '0.75rem',
            }}>
              <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Warnings</div>
              {(previewReceipt.data?.warnings || []).map((warning, index) => (
                <div key={index}>{warning}</div>
              ))}
            </div>
          )}

          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', minHeight: '520px' }}>
            {previewHtml ? (
              <ReceiptHtmlPreview html={previewHtml} />
            ) : hasNoDonorResult ? (
              <div style={{ padding: '2rem', color: '#9ca3af', textAlign: 'center' }}>
                No donors found for the selected fiscal year and accounts.
              </div>
            ) : (
              <div style={{ padding: '2rem', color: '#9ca3af', textAlign: 'center' }}>
                Select accounts and run preview.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
            <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>
              {previewReceipt.data ? `${previewReceipt.data.donor_count} donor receipt${previewReceipt.data.donor_count === 1 ? '' : 's'} found.` : ''}
            </div>
            <Button
              onClick={handleGenerate}
              isLoading={generateReceiptPdf.isPending}
              disabled={!numericAccountIds.length || !htmlBody.trim()}
            >
              Download PDF
            </Button>
          </div>
        </Card>
      </div>

      {status.message && (
        <div style={{
          marginTop: '1rem',
          border: status.type === 'success' ? '1px solid #bbf7d0' : status.type === 'warning' ? '1px solid #fde68a' : '1px solid #fecaca',
          background: status.type === 'success' ? '#f0fdf4' : status.type === 'warning' ? '#fffbeb' : '#fef2f2',
          color: status.type === 'success' ? '#166534' : status.type === 'warning' ? '#78350f' : '#991b1b',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          fontSize: '0.85rem',
        }}>
          {status.message}
        </div>
      )}
    </div>
  )
}
