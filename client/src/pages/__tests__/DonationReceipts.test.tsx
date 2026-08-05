import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../test/msw/browser'
import { renderWithProviders } from '../../test/renderWithProviders'
import DonationReceipts from '../DonationReceipts'
import { getCurrentFiscalYear } from '../../utils/fiscalYear'

import type { AuthUser } from '@shared/contracts'

const admin: AuthUser = {
  id: 1,
  name: 'Admin',
  email: 'admin@example.com',
  avatar_url: null,
  role: 'admin',
}

const TEMPLATE_BODY = '<p>Hello {{donor_name}}</p>'
const VARIABLES = ['donor_name', 'donor_id', 'total_amount', 'fiscal_year']

function seedDefaults() {
  worker.use(
    http.get('/api/settings', () => HttpResponse.json({ settings: [], values: {} })),
    http.get('/api/donation-receipts/template', () => HttpResponse.json({
      template: { html_body: TEMPLATE_BODY, updated_at: null },
      variables: VARIABLES,
    })),
    http.get('/api/donation-receipts/accounts', () => HttpResponse.json({
      fiscal_year: 2025,
      period_start: '2025-01-01',
      period_end: '2025-12-31',
      accounts: [{ id: 3, code: '4100', name: 'Donations', total: 40 }],
    })),
  )
}

async function selectDonationsAccount(screen: Awaited<ReturnType<typeof renderWithProviders>>) {
  await screen.getByText('Select income accounts').click()
  await screen.getByText('4100 — Donations ($40.00)').click()
}

describe('DonationReceipts', () => {
  beforeEach(async () => {
    // The default test viewport is mobile-sized (414×896), which collapses the
    // two-column editor/preview grid and lets the preview card overlay the
    // template card. This page is desktop-only, so use a desktop viewport.
    await page.viewport(1280, 800)
  })

  it('loads the saved HTML template into the editor', async () => {
    seedDefaults()
    const screen = await renderWithProviders(<DonationReceipts />, { auth: admin })

    await expect.element(screen.getByRole('textbox')).toHaveValue(TEMPLATE_BODY)
  })

  it('inserts template variables via the variable chips', async () => {
    seedDefaults()
    const screen = await renderWithProviders(<DonationReceipts />, { auth: admin })

    const textarea = screen.getByRole('textbox')
    await expect.element(textarea).toHaveValue(TEMPLATE_BODY)

    await screen.getByRole('button', { name: '{{donor_id}}' }).click()
    await vi.waitFor(() => {
      expect((textarea.element() as HTMLTextAreaElement).value).toContain('{{donor_id}}')
    })
  })

  it('saves the HTML template and reports success', async () => {
    seedDefaults()
    let body: unknown = null
    worker.use(http.put('/api/donation-receipts/template', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({
        template: { html_body: '<p>Hello {{donor_name}}</p>', updated_at: null },
        variables: VARIABLES,
      })
    }))
    const screen = await renderWithProviders(<DonationReceipts />, { auth: admin })

    await screen.getByRole('button', { name: 'Save Template' }).click()
    await expect.element(screen.getByText('Template saved.')).toBeVisible()
    expect(body).toEqual({ html_body: TEMPLATE_BODY })
  })

  it('renders the preview in a sandboxed srcdoc iframe', async () => {
    seedDefaults()
    worker.use(http.post('/api/donation-receipts/preview', () => HttpResponse.json({
      html: '<p>Hello Ana Donor</p>',
      warnings: [],
      donor_count: 1,
    })))
    const screen = await renderWithProviders(<DonationReceipts />, { auth: admin })

    await selectDonationsAccount(screen)
    await screen.getByRole('button', { name: 'Preview' }).click()

    const iframe = screen.getByTitle('Receipt preview')
    await vi.waitFor(() => {
      const srcdoc = (iframe.element() as HTMLIFrameElement).getAttribute('srcdoc')
      expect(srcdoc).toContain('<div class="receipt-preview">')
      expect(srcdoc).toContain('<p>Hello Ana Donor</p>')
    })
    expect((iframe.element() as HTMLIFrameElement).getAttribute('sandbox')).toBe('')
  })

  it('shows the no-donor state when preview returns html: null', async () => {
    seedDefaults()
    worker.use(http.post('/api/donation-receipts/preview', () => HttpResponse.json({
      html: null,
      warnings: [],
      donor_count: 0,
    })))
    const screen = await renderWithProviders(<DonationReceipts />, { auth: admin })

    await selectDonationsAccount(screen)
    await screen.getByRole('button', { name: 'Preview' }).click()

    await expect.element(
      screen.getByText('No donors found for the selected fiscal year and accounts.')
    ).toBeVisible()
  })

  it('downloads the generated PDF with the html_body payload', async () => {
    seedDefaults()
    let body: unknown = null
    worker.use(http.post('/api/donation-receipts/generate-pdf', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({
        pdf_base64: 'JVBERi0=',
        filename: 'donation_receipts_fy2025.pdf',
        meta: {
          fiscal_year: 2025,
          period_start: '2025-01-01',
          period_end: '2025-12-31',
          donor_count: 1,
          warnings: [],
        },
      })
    }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const screen = await renderWithProviders(<DonationReceipts />, { auth: admin })

    await selectDonationsAccount(screen)
    await screen.getByRole('button', { name: 'Download PDF' }).click()

    await expect.element(screen.getByText('Downloaded 1 receipt(s).')).toBeVisible()
    expect(body).toEqual({
      fiscal_year: getCurrentFiscalYear(1),
      account_ids: [3],
      html_body: TEMPLATE_BODY,
    })
    expect(clickSpy).toHaveBeenCalled()
  })
})
