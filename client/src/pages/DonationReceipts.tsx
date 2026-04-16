import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
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
import MultiSelectCombobox from '../components/ui/MultiSelectCombobox'
import { getErrorMessage } from '../utils/errors'
import type { OptionValue } from '../components/ui/types'

type ReceiptStatusType = 'success' | 'warning' | 'error' | null

const fmt = (n: number | string | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 })

const previewStyles = `
  .receipt-preview {
    padding: 2.5rem;
    color: #111827;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 0.9rem;
    line-height: 1.55;
    background: white;
  }
  .receipt-preview h1 {
    margin: 0 0 1rem;
    font-size: 1.55rem;
    line-height: 1.25;
  }
  .receipt-preview h2 {
    margin: 1rem 0 0.6rem;
    font-size: 1.15rem;
    line-height: 1.3;
  }
  .receipt-preview h3 {
    margin: 0.85rem 0 0.5rem;
    font-size: 1rem;
    line-height: 1.3;
  }
  .receipt-preview p {
    margin: 0 0 0.75rem;
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
    border-collapse: collapse;
    margin-bottom: 0.9rem;
    font-size: 0.82rem;
  }
  .receipt-preview th,
  .receipt-preview td {
    border: 1px solid #d1d5db;
    padding: 0.45rem 0.55rem;
    text-align: left;
  }
  .receipt-preview th {
    background: #f3f4f6;
  }
  .receipt-preview blockquote {
    margin: 0 0 0.75rem;
    padding-left: 0.75rem;
    border-left: 3px solid #9ca3af;
  }
  .receipt-preview hr {
    border: 0;
    border-top: 1px solid #9ca3af;
    margin: 0.75rem 0;
  }
  .receipt-preview code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.82rem;
  }
  .receipt-preview a {
    color: #1d4ed8;
    text-decoration: underline;
  }
  .receipt-preview-center {
    text-align: center;
  }
`

function getCurrentFiscalYear(fiscalStartMonth: number) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  if (fiscalStartMonth === 1) return year
  return month >= fiscalStartMonth ? year + 1 : year
}

function renderPreviewHtml(markdown: string) {
  const centerBlocks: string[] = []
  const withPlaceholders = markdown.replace(/^:::center\s*\n([\s\S]*?)^:::\s*$/gm, (_match, content: string) => {
    const token = `@@CENTER_BLOCK_${centerBlocks.length}@@`
    centerBlocks.push(`<div class="receipt-preview-center">${marked.parse(content.trim(), { gfm: true, breaks: false })}</div>`)
    return token
  })

  let html = marked.parse(withPlaceholders, { gfm: true, breaks: false }) as string
  centerBlocks.forEach((block, index) => {
    html = html
      .replace(`<p>@@CENTER_BLOCK_${index}@@</p>`, () => block)
      .replace(`@@CENTER_BLOCK_${index}@@`, () => block)
  })
  return html
}

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

function ReceiptMarkdownPreview({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderPreviewHtml(markdown), [markdown])
  return (
    <>
      <style>{previewStyles}</style>
      <div className="receipt-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  )
}

export default function DonationReceipts() {
  const { data: settings } = useSettings()
  const fiscalStartMonth = Math.max(1, Math.min(12, parseInt(settings?.fiscal_year_start || '1', 10) || 1))
  const currentFiscalYear = getCurrentFiscalYear(fiscalStartMonth)

  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear)
  const [accountIds, setAccountIds] = useState<OptionValue[]>([])
  const [markdownBody, setMarkdownBody] = useState('')
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
    if (templateQuery.data?.template?.markdown_body) {
      setMarkdownBody(templateQuery.data.template.markdown_body)
    }
  }, [templateQuery.data?.template?.markdown_body])

  const accounts = accountsQuery.data?.accounts || []
  const selectedAccounts = new Set(accountIds)
  const numericAccountIds = useMemo(
    () => accountIds.filter((id): id is number => typeof id === 'number'),
    [accountIds]
  )
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
      await saveTemplate.mutateAsync({ markdown_body: markdownBody })
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
        markdown_body: markdownBody,
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
        markdown_body: markdownBody,
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

  const previewMarkdown = previewReceipt.data?.markdown || null
  const hasPreviewResult = Boolean(previewReceipt.data)
  const hasNoDonorResult = hasPreviewResult && previewMarkdown === null

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
          <MultiSelectCombobox
            label="Income Accounts"
            options={accountOptions}
            value={accountIds}
            onChange={(ids) => {
              setAccountIds(ids)
              previewReceipt.reset()
            }}
            placeholder="Select income accounts"
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
              <h2 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Markdown Template</h2>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.2rem' }}>
                Use the variables listed below. Unknown variables are rejected by the server.
              </div>
            </div>
            <Button onClick={handleSaveTemplate} isLoading={saveTemplate.isPending} disabled={!markdownBody.trim()}>
              Save Template
            </Button>
          </div>

          <textarea
            value={markdownBody}
            onChange={(event) => {
              setMarkdownBody(event.target.value)
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
                  onClick={() => setMarkdownBody((body) => `${body}${body.endsWith('\n') || !body ? '' : ' '}{{${variable}}}`)}
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
              disabled={!numericAccountIds.length || !markdownBody.trim()}
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
            {previewMarkdown ? (
              <ReceiptMarkdownPreview markdown={previewMarkdown} />
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
              disabled={!numericAccountIds.length || !markdownBody.trim()}
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
