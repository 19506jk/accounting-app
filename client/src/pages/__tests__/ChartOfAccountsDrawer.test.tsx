import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'
import * as XLSX from 'xlsx'

import { worker } from '../../test/msw/browser'
import { renderWithProviders } from '../../test/renderWithProviders'
import ChartOfAccounts from '../ChartOfAccounts'

import type {
  AccountSummary,
  AuthUser,
  FundSummary,
  LedgerReportAccount,
  LedgerReportResponse,
} from '@shared/contracts'

const authUser: AuthUser = {
  id: 1,
  name: 'Admin User',
  email: 'admin@example.com',
  role: 'admin',
  avatar_url: null,
}

function accountSummary(overrides: Partial<AccountSummary>): AccountSummary {
  return {
    id: 1,
    code: '1000',
    name: 'Account',
    type: 'ASSET',
    account_class: 'ASSET',
    normal_balance: 'DEBIT',
    parent_id: null,
    is_active: true,
    is_deletable: true,
    ...overrides,
  }
}

function fundSummary(overrides: Partial<FundSummary>): FundSummary {
  return {
    id: 10,
    name: 'General Fund',
    description: 'Operations',
    is_active: true,
    created_at: '2026-06-01T00:00:00Z',
    net_asset_account_id: 3,
    net_asset_code: '3000',
    net_asset_name: 'General Fund - Net Assets',
    ...overrides,
  }
}

function ledgerResponse(ledger: LedgerReportAccount[]): LedgerReportResponse {
  return {
    report: {
      type: 'ledger',
      generated_at: '2026-06-16T00:00:00Z',
      filters: { from: '2026-06-01', to: '2026-06-30' },
      data: { ledger },
    },
  }
}

function stubChartApis({
  accountLedger,
}: {
  accountLedger: LedgerReportAccount[]
}) {
  const accounts = [
    accountSummary({
      id: 3,
      code: '3000',
      name: 'General Fund - Net Assets',
      type: 'EQUITY',
      account_class: 'EQUITY',
      normal_balance: 'CREDIT',
    }),
    accountSummary({
      id: 1,
      code: '1000',
      name: 'Operating Cash',
      type: 'ASSET',
    }),
  ]

  const funds = [
    fundSummary({
      id: 10,
      net_asset_account_id: 3,
      net_asset_code: '3000',
      net_asset_name: 'General Fund - Net Assets',
    }),
  ]

  const fundLedger = [
    {
      account: { id: 1, code: '1000', name: 'Operating Cash', type: 'ASSET' as const },
      opening_balance: 0,
      closing_balance: 1000,
      rows: [
        {
          date: '2026-06-02',
          description: 'Deposit',
          reference_no: 'DEP-1',
          contact_name: null,
          fund_name: 'General Fund',
          debit: 1000,
          credit: 0,
          memo: null,
          balance: 51000,
        },
      ],
    },
    {
      account: { id: 4, code: '4000', name: 'Offerings', type: 'INCOME' as const },
      opening_balance: 0,
      closing_balance: 1000,
      rows: [
        {
          date: '2026-06-02',
          description: 'Deposit',
          reference_no: 'DEP-1',
          contact_name: null,
          fund_name: 'General Fund',
          debit: 0,
          credit: 1000,
          memo: null,
          balance: 1000,
        },
      ],
    },
  ]

  worker.use(
    http.get('/api/accounts', () => HttpResponse.json({ accounts })),
    http.get('/api/funds', () => HttpResponse.json({ funds })),
    http.get('/api/reports/ledger', ({ request }) => {
      const params = new URL(request.url).searchParams

      if (params.get('fund_id') === '10') {
        return HttpResponse.json(ledgerResponse(fundLedger))
      }

      if (params.get('account_id') === '1') {
        return HttpResponse.json(ledgerResponse(accountLedger))
      }

      return HttpResponse.json(ledgerResponse([]))
    }),
  )
}

async function openDrawer(screen: Awaited<ReturnType<typeof renderWithProviders>>, name: string) {
  await expect.element(screen.getByText(name)).toBeVisible()
  await userEvent.click(screen.getByText(name))
  await expect.element(screen.getByRole('button', { name: 'Export Excel' })).toBeVisible()
}

function headerTexts() {
  return Array.from(document.querySelectorAll('th')).map((cell) => cell.textContent?.trim() || '')
}

describe('ChartOfAccounts drawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('hides the Balance column in fund mode', async () => {
    stubChartApis({
      accountLedger: [
        {
          account: { id: 1, code: '1000', name: 'Operating Cash', type: 'ASSET' },
          opening_balance: 250,
          closing_balance: 250,
          rows: [],
        },
      ],
    })

    const screen = await renderWithProviders(<ChartOfAccounts />, { auth: authUser })
    await openDrawer(screen, 'General Fund - Net Assets')

    await expect.poll(headerTexts).toEqual([
      'Date',
      'Reference No',
      'Description',
      'Fund',
      'Debit',
      'Credit',
    ])
  })

  it('keeps the Balance column and empty-state colSpan in account mode', async () => {
    stubChartApis({
      accountLedger: [
        {
          account: { id: 1, code: '1000', name: 'Operating Cash', type: 'ASSET' },
          opening_balance: 250,
          closing_balance: 250,
          rows: [],
        },
      ],
    })

    const screen = await renderWithProviders(<ChartOfAccounts />, { auth: authUser })
    await openDrawer(screen, 'Operating Cash')

    await expect.poll(headerTexts).toEqual([
      'Date',
      'Reference No',
      'Description',
      'Fund',
      'Debit',
      'Credit',
      'Balance',
    ])
    const emptyCell = screen.getByText('No entries in this date range.')
    await expect.poll(() => emptyCell.element()?.getAttribute('colspan')).toBe('7')
  })

  it('exports a 6-column fund-mode worksheet', async () => {
    const aoaSpy = vi.spyOn(XLSX.utils, 'aoa_to_sheet')

    stubChartApis({
      accountLedger: [
        {
          account: { id: 1, code: '1000', name: 'Operating Cash', type: 'ASSET' },
          opening_balance: 250,
          closing_balance: 260,
          rows: [
            {
              date: '2026-06-03',
              description: 'Deposit',
              reference_no: 'DEP-2',
              contact_name: null,
              fund_name: 'General Fund',
              debit: 10,
              credit: 0,
              memo: null,
              balance: 260,
            },
          ],
        },
      ],
    })

    const screen = await renderWithProviders(<ChartOfAccounts />, { auth: authUser })
    await openDrawer(screen, 'General Fund - Net Assets')
    await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }))

    const rows = aoaSpy.mock.calls.at(-1)?.[0] as Array<Array<string | number>>
    expect(rows[3]).toHaveLength(6)
    expect(rows[4]).toHaveLength(6)
    expect(rows[5]).toHaveLength(6)
  })

  it('exports a 7-column account-mode worksheet', async () => {
    const aoaSpy = vi.spyOn(XLSX.utils, 'aoa_to_sheet')

    stubChartApis({
      accountLedger: [
        {
          account: { id: 1, code: '1000', name: 'Operating Cash', type: 'ASSET' },
          opening_balance: 250,
          closing_balance: 260,
          rows: [
            {
              date: '2026-06-03',
              description: 'Deposit',
              reference_no: 'DEP-2',
              contact_name: null,
              fund_name: 'General Fund',
              debit: 10,
              credit: 0,
              memo: null,
              balance: 260,
            },
          ],
        },
      ],
    })

    const screen = await renderWithProviders(<ChartOfAccounts />, { auth: authUser })
    await openDrawer(screen, 'Operating Cash')
    await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }))

    const rows = aoaSpy.mock.calls.at(-1)?.[0] as Array<Array<string | number>>
    expect(rows[3]).toHaveLength(7)
    expect(rows[4]).toHaveLength(7)
    expect(rows[5]).toHaveLength(7)
  })
})
