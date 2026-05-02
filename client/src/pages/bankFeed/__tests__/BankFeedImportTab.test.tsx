import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../../test/msw/browser'
import { renderWithProviders } from '../../../test/renderWithProviders'
import BankFeedImportTab from '../BankFeedImportTab'
import { parseStatementCsv } from '../../../utils/parseStatementCsv'

vi.mock('../../../utils/parseStatementCsv', () => ({
  parseStatementCsv: vi.fn(),
}))

describe('BankFeedImportTab', () => {
  it('renders import action disabled before parsing rows', async () => {
    const screen = renderWithProviders(
      <BankFeedImportTab
        isActive={false}
        bankAccountOptions={[{ value: 1, label: '1000 - Chequing' }]}
        fundOptions={[{ value: 1, label: 'General' }]}
        postImportNeedsReview={0}
        setPostImportNeedsReview={vi.fn()}
      />
    )

    await expect.element(screen.getByText('No rows parsed yet')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Confirm Import' })).toBeDisabled()
  })

  it('shows validation errors when import is attempted without required selections', async () => {
    vi.mocked(parseStatementCsv).mockResolvedValueOnce({
      rows: [
        {
          date: '2026-04-10',
          amount: 50,
          type: 'deposit',
          description: 'Donation',
          raw_description: 'Donation',
          reference_no: '',
        },
      ],
      warnings: [],
      metadata: [
        {
          description_1: 'Donation',
          description_2: '',
          payment_method: '',
          sender: '',
          from: '',
        },
      ],
    } as never)

    worker.use(
      http.get('/api/bank-transactions/uploads', () => HttpResponse.json({ uploads: [] }))
    )

    const screen = renderWithProviders(
      <BankFeedImportTab
        isActive
        bankAccountOptions={[]}
        fundOptions={[]}
        postImportNeedsReview={0}
        setPostImportNeedsReview={vi.fn()}
      />
    )

    const fileInput = screen.getByLabelText('CSV File')
    const file = new File(['date,amount'], 'bank.csv', { type: 'text/csv' })
    await userEvent.upload(fileInput, file)
    await expect.element(screen.getByText('1 rows found')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Import' }))

    await expect.element(screen.getByText('Bank account is required')).toBeVisible()
    await expect.element(screen.getByText('Fund is required')).toBeVisible()
  })

  it('imports parsed rows and renders summary details', async () => {
    vi.mocked(parseStatementCsv).mockResolvedValueOnce({
      rows: [
        {
          date: '2026-04-10',
          amount: 25,
          type: 'deposit',
          description: 'Interac',
          raw_description: 'INTERAC PAYMENT',
          reference_no: 'REF-9',
        },
      ],
      warnings: ['Minor warning'],
      metadata: [
        {
          description_1: 'INTERAC PAYMENT',
          description_2: 'April donation',
          payment_method: 'Interac e-Transfer',
          sender: 'Jane Doe',
          from: 'jane@example.com',
        },
      ],
    } as never)

    let importBody: unknown = null
    const setPostImportNeedsReview = vi.fn()

    worker.use(
      http.get('/api/bank-transactions/uploads', () => HttpResponse.json({
        uploads: [
          {
            id: 11,
            account_id: 1,
            account_name: 'Chequing',
            fund_id: 1,
            fund_name: 'General',
            uploaded_by: 1,
            filename: 'bank.csv',
            row_count: 1,
            imported_at: '2026-04-10T00:00:00.000Z',
          },
        ],
      })),
      http.post('/api/bank-transactions/import', async ({ request }) => {
        importBody = await request.json()
        return HttpResponse.json({
          upload_id: 11,
          inserted: 1,
          skipped: 0,
          needs_review: 1,
          warnings: [],
        })
      })
    )

    const screen = renderWithProviders(
      <BankFeedImportTab
        isActive
        bankAccountOptions={[
          { value: 1, label: '1000 - Chequing' },
          { value: 2, label: '2000 - Savings' },
        ]}
        fundOptions={[
          { value: 1, label: 'General' },
          { value: 2, label: 'Missions' },
        ]}
        postImportNeedsReview={0}
        setPostImportNeedsReview={setPostImportNeedsReview}
      />
    )

    await userEvent.click(screen.getByText(/Select bank account|1000 - Chequing/))
    await userEvent.click(screen.getByText('2000 - Savings'))
    await userEvent.click(screen.getByText(/Select fund|General/))
    await userEvent.click(screen.getByText('Missions'))

    const fileInput = screen.getByLabelText('CSV File')
    const file = new File(['date,amount'], 'bank.csv', { type: 'text/csv' })
    await userEvent.upload(fileInput, file)
    await expect.element(screen.getByText('Minor warning')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Import' }))

    await vi.waitFor(() => {
      expect(importBody).toEqual({
        account_id: 2,
        fund_id: 2,
        filename: 'bank.csv',
        rows: [
          {
            bank_posted_date: '2026-04-10',
            bank_effective_date: null,
            raw_description: 'INTERAC PAYMENT',
            amount: 25,
            bank_transaction_id: 'REF-9',
            sender_name: 'Jane Doe',
            sender_email: 'jane@example.com',
            bank_description_2: 'April donation',
            payment_method: 'Interac e-Transfer',
          },
        ],
      })
      expect(setPostImportNeedsReview).toHaveBeenCalledWith(1)
      expect(screen.container.textContent || '').toContain('Import Summary')
      expect(screen.container.textContent || '').toContain('Upload #11: 1 inserted, 0 skipped, 1 needs review.')
    })
  })
})
