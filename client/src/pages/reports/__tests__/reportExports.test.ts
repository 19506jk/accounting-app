import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkBook } from 'xlsx'

import type {
  BalanceSheetReportData,
  BalanceSheetReportFilters,
  ContactSummary,
  DonorDetailReportData,
  DonorDetailReportFilters,
  DonorSummaryReportData,
  DonorSummaryReportFilters,
  LedgerReportData,
  LedgerReportFilters,
  PLReportData,
  PLReportFilters,
  ReconciliationReport,
  TrialBalanceReportData,
  TrialBalanceReportFilters,
} from '@shared/contracts'

const writeFileMock = vi.fn()

function sheetRows(xlsx: typeof import('xlsx'), workbook: WorkBook, name?: string) {
  const sheetName = name || workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return xlsx.utils.sheet_to_json(sheet, { header: 1 }) as Array<Array<string | number | null>>
}

async function loadSubject() {
  vi.resetModules()

  vi.doMock('xlsx', async () => {
    const actual = await vi.importActual<typeof import('xlsx')>('xlsx')
    return {
      ...actual,
      writeFile: writeFileMock,
    }
  })

  const xlsx = await import('xlsx')
  const subject = await import('../reportExports')
  return { xlsx, writeFile: writeFileMock, ...subject }
}

describe('reportExports', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T11:00:00Z'))
    vi.clearAllMocks()
    writeFileMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exports P&L workbook with headers and totals', async () => {
    const { exportPL, writeFile, xlsx } = await loadSubject()
    const data: PLReportData = {
      income: [{ id: 1, code: '4000', name: 'Donations', amount: 250 }],
      expenses: [{ id: 2, code: '5000', name: 'Rent', amount: 100 }],
      total_income: 250,
      total_expenses: 100,
      net_surplus: 150,
    }
    const filters: PLReportFilters = { from: '2026-01-01', to: '2026-03-31' }

    exportPL(data, filters)

    expect(writeFile).toHaveBeenCalledWith(expect.any(Object), 'pl_2026-01-01_2026-03-31.xlsx')
    const workbook = writeFile.mock.calls[0]?.[0] as WorkBook
    const rows = sheetRows(xlsx, workbook, 'P&L')
    expect(rows).toContainEqual(['Statement of Activities', '', ''])
    expect(rows).toContainEqual(['', 'Total Income', 250])
    expect(rows).toContainEqual(['', 'Total Expenses', 100])
    expect(rows).toContainEqual(['Net Surplus / (Deficit)', '', 150])
  })

  it('exports balance sheet workbook with balance status row', async () => {
    const { exportBalanceSheet, writeFile, xlsx } = await loadSubject()
    const data: BalanceSheetReportData = {
      assets: [{ id: 1, code: '1000', name: 'Cash', balance: 100 }],
      liabilities: [{ id: 2, code: '2000', name: 'AP', balance: 30 }],
      equity: [{ id: 3, code: '3000', name: 'Net Assets', balance: 70 }],
      total_assets: 100,
      total_liabilities: 30,
      total_equity: 70,
      total_liabilities_and_equity: 100,
      is_balanced: true,
      diagnostics: [],
      last_hard_close_date: null,
    }
    const filters: BalanceSheetReportFilters = { as_of: '2026-03-31' }

    exportBalanceSheet(data, filters)

    expect(writeFile).toHaveBeenCalledWith(expect.any(Object), 'balance_sheet_2026-03-31.xlsx')
    const workbook = writeFile.mock.calls[0]?.[0] as WorkBook
    const rows = sheetRows(xlsx, workbook, 'Balance Sheet')
    expect(rows).toContainEqual(['Statement of Financial Position', '', ''])
    expect(rows).toContainEqual(['', 'Total Assets', 100])
    expect(rows).toContainEqual(['Balanced', '', 'YES'])
  })

  it('exports ledger workbook with opening and closing rows plus reference fallback', async () => {
    const { exportLedger, writeFile, xlsx } = await loadSubject()
    const data: LedgerReportData = {
      ledger: [
        {
          account: { id: 1, code: '1000', name: 'Cash', type: 'ASSET' },
          opening_balance: 50,
          closing_balance: 60,
          rows: [
            {
              date: '2026-03-02',
              description: 'Deposit',
              reference_no: null,
              contact_name: null,
              fund_name: 'General',
              debit: 10,
              credit: 0,
              memo: null,
              balance: 60,
            },
          ],
        },
      ],
    }
    const filters: LedgerReportFilters = { from: '2026-03-01', to: '2026-03-31' }

    exportLedger(data, filters)

    expect(writeFile).toHaveBeenCalledWith(expect.any(Object), 'ledger_2026-03-01_2026-03-31.xlsx')
    const workbook = writeFile.mock.calls[0]?.[0] as WorkBook
    const rows = sheetRows(xlsx, workbook, 'General Ledger')
    expect(rows).toContainEqual(['Opening Balance', '', '', '', '', '', '', 50])
    expect(rows).toContainEqual(['2026-03-02', '-', 'Deposit', 'Unassigned', 'General', 10, '', 60])
    expect(rows).toContainEqual(['Closing Balance', '', '', '', '', '', '', 60])
  })

  it('exports trial balance workbook and includes synthetic labels', async () => {
    const { exportTrialBalance, writeFile, xlsx } = await loadSubject()
    const data: TrialBalanceReportData = {
      accounts: [
        {
          id: 1,
          code: '1000',
          name: 'Cash',
          type: 'ASSET',
          account_class: 'ASSET',
          normal_balance: 'DEBIT',
          net_side: 'DEBIT',
          net_debit: 100,
          net_credit: 0,
          total_debit: 100,
          total_credit: 0,
          is_abnormal_balance: false,
          is_synthetic: false,
          synthetic_note: null,
          investigate_filters: null,
        },
        {
          id: 2,
          code: '3000',
          name: '[System] Net Income (Prior Years) - General',
          type: 'EQUITY',
          account_class: 'EQUITY',
          normal_balance: 'CREDIT',
          net_side: 'CREDIT',
          net_debit: 0,
          net_credit: 10,
          total_debit: 0,
          total_credit: 10,
          is_abnormal_balance: false,
          is_synthetic: true,
          synthetic_note: null,
          investigate_filters: null,
        },
      ],
      grand_total_debit: 100,
      grand_total_credit: 10,
      is_balanced: false,
      as_of: '2026-03-31',
      fiscal_year_start: '2026-01-01',
      diagnostics: [],
      last_hard_close_date: null,
    }
    const filters: TrialBalanceReportFilters = { as_of: '2026-03-31' }

    exportTrialBalance(data, filters)

    expect(writeFile).toHaveBeenCalledWith(expect.any(Object), 'trial_balance_2026-03-31.xlsx')
    const workbook = writeFile.mock.calls[0]?.[0] as WorkBook
    const rows = sheetRows(xlsx, workbook, 'Trial Balance')
    expect(rows).toContainEqual(['Code', 'Account', 'Debit', 'Credit'])
    expect(rows).toContainEqual(['3000', '[System] Net Income (Prior Years) - General [Synthetic]', 0, 10])
    expect(rows).toContainEqual(['TOTALS', '', 100, 10])
  })

  it('exports donor summary and donor detail workbooks with totals', async () => {
    const { exportDonorDetail, exportDonorSummary, writeFile, xlsx } = await loadSubject()
    const summaryData: DonorSummaryReportData = {
      donors: [{ contact_id: 1, contact_name: 'Jane Doe', contact_class: 'INDIVIDUAL', total: 200, transaction_count: 2 }],
      anonymous: { total: 50, transaction_count: 1 },
      grand_total: 250,
      donor_count: 1,
    }
    const summaryFilters: DonorSummaryReportFilters = { from: '2026-01-01', to: '2026-03-31' }

    exportDonorSummary(summaryData, summaryFilters)

    expect(writeFile).toHaveBeenLastCalledWith(expect.any(Object), 'donor_summary_2026-01-01_2026-03-31.xlsx')
    let workbook = writeFile.mock.calls[0]?.[0] as WorkBook
    let rows = sheetRows(xlsx, workbook, 'Donor Summary')
    expect(rows).toContainEqual(['Income by Donor — Summary', '', '', ''])
    expect(rows).toContainEqual(['Grand Total', '', '', 250])

    const detailData: DonorDetailReportData = {
      donors: [
        {
          contact_id: 1,
          contact_name: 'Jane Doe',
          contact_class: 'INDIVIDUAL',
          donor_id: null,
          total: 200,
          transactions: [
            {
              transaction_id: 9,
              date: '2026-03-03',
              description: 'Donation',
              reference_no: null,
              account_code: '4000',
              account_name: 'Donations',
              fund_name: 'General',
              amount: 200,
              memo: null,
            },
          ],
        },
      ],
      anonymous: {
        total: 50,
        transactions: [
          {
            transaction_id: 10,
            date: '2026-03-05',
            description: 'Anonymous gift',
            reference_no: null,
            account_code: '4000',
            account_name: 'Donations',
            fund_name: 'General',
            amount: 50,
            memo: null,
          },
        ],
      },
      grand_total: 250,
    }
    const detailFilters: DonorDetailReportFilters = { from: '2026-01-01', to: '2026-03-31' }

    exportDonorDetail(detailData, detailFilters)

    expect(writeFile).toHaveBeenLastCalledWith(expect.any(Object), 'donor_detail_2026-01-01_2026-03-31.xlsx')
    workbook = writeFile.mock.calls[1]?.[0] as WorkBook
    rows = sheetRows(xlsx, workbook, 'Donor Detail')
    expect(rows).toContainEqual(['Income by Donor — Detail', '', '', '', ''])
    expect(rows).toContainEqual(['Grand Total', '', '', '', 250])
  })

  it('exports active contacts with dated filename', async () => {
    const { exportContacts, writeFile, xlsx } = await loadSubject()
    const contacts: ContactSummary[] = [
      {
        id: 1,
        type: 'DONOR',
        contact_class: 'INDIVIDUAL',
        name: 'Jane Doe',
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        province: null,
        postal_code: null,
        donor_id: 'D-100',
        is_active: true,
      },
      {
        id: 2,
        type: 'DONOR',
        contact_class: 'HOUSEHOLD',
        name: 'Inactive Household',
        first_name: null,
        last_name: null,
        email: null,
        phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        province: null,
        postal_code: null,
        donor_id: null,
        is_active: false,
      },
    ]

    exportContacts(contacts)

    expect(writeFile).toHaveBeenCalledWith(expect.any(Object), 'contacts_2026-04-10.xlsx')
    const workbook = writeFile.mock.calls[0]?.[0] as WorkBook
    const rows = sheetRows(xlsx, workbook, 'Contacts')
    expect(rows).toContainEqual(['Contacts & Donors'])
    expect(rows).toContainEqual([
      'D-100',
      'Jane Doe',
      'Jane',
      'Doe',
      'jane@example.com',
      '',
      '',
      '',
      '',
      '',
      '',
    ])
    expect(rows.flat().includes('Inactive Household')).toBe(false)
  })

  it('exports reconciliation report with summary and detail sheets', async () => {
    const { exportReconciliationReport, writeFile, xlsx } = await loadSubject()
    const report: ReconciliationReport = {
      account_name: 'Checking',
      account_code: '1000',
      account_type: 'ASSET',
      is_closed: false,
      status: 'BALANCED',
      statement_period_start: '2026-03-01',
      statement_period_end: '2026-03-31',
      reconciliation_date: '2026-04-01T14:30:00.000Z',
      reconciler_name: 'Admin',
      opening_balance: 1000,
      cleared_in: 200,
      cleared_out: 150,
      statement_ending_balance: 1050,
      in_transit: 100,
      outstanding_out: 50,
      adjusted_bank_balance: 1100,
      book_balance: 1100,
      difference: 0,
      cleared_in_items: [
        {
          date: '2026-03-05',
          reference_no: null,
          payee: 'Donor',
          description: 'Deposit',
          memo: null,
          amount: 200,
          fund_name: 'General',
        },
      ],
      cleared_out_items: [
        {
          date: '2026-03-06',
          reference_no: 'CHK100',
          payee: 'Vendor',
          description: 'Expense',
          memo: null,
          amount: 150,
          fund_name: 'General',
        },
      ],
      in_transit_items: [],
      outstanding_out_items: [],
      fund_activity: [],
    }

    exportReconciliationReport(report)

    expect(writeFile).toHaveBeenCalledWith(expect.any(Object), 'reconciliation_report_1000_2026-03-31.xlsx')
    const workbook = writeFile.mock.calls[0]?.[0] as WorkBook
    const summaryRows = sheetRows(xlsx, workbook, 'Summary')
    const detailRows = sheetRows(xlsx, workbook, 'Detail')
    expect(summaryRows.flat()).toContain('Reconciliation Summary')
    expect(summaryRows.flat()).toContain('Cleared Balance')
    expect(detailRows.flat()).toContain('Reconciliation Detail')
    expect(detailRows.flat()).toContain('Beginning Balance')
  })

  it('exports liability reconciliation report with fallback date/time and charge labels', async () => {
    const { exportReconciliationReport, writeFile, xlsx } = await loadSubject()
    const report: ReconciliationReport = {
      account_name: 'Credit Card',
      account_code: '2200',
      account_type: 'LIABILITY',
      is_closed: false,
      status: 'BALANCED',
      statement_period_start: '2026-03-01',
      statement_period_end: '2026/03/31',
      reconciliation_date: 'not-a-date',
      reconciler_name: 'Admin',
      opening_balance: 300,
      cleared_in: 25,
      cleared_out: 80,
      statement_ending_balance: 245,
      in_transit: 10,
      outstanding_out: 5,
      adjusted_bank_balance: 250,
      book_balance: 250,
      difference: 0,
      cleared_in_items: [],
      cleared_out_items: [
        {
          date: '2026-03-12',
          reference_no: '',
          payee: '',
          description: 'Card charge',
          memo: null,
          amount: 80,
          fund_name: 'General',
        },
      ],
      in_transit_items: [],
      outstanding_out_items: [],
      fund_activity: [],
    }

    exportReconciliationReport(report)

    expect(writeFile).toHaveBeenCalledWith(expect.any(Object), 'reconciliation_report_2200_2026/03/31.xlsx')
    const workbook = writeFile.mock.calls[0]?.[0] as WorkBook
    const summaryRows = sheetRows(xlsx, workbook, 'Summary')
    const detailRows = sheetRows(xlsx, workbook, 'Detail')

    expect(summaryRows).toContainEqual(['2200 Credit Card', '', '', '', ''])
    expect(summaryRows).toContainEqual(['Reconciliation Summary', '', '', '', '2026/03/31'])
    expect(summaryRows.flat()).toContain('Charges - 1 items')
    expect(summaryRows.flat()).toContain('Receipts - 0 items')
    expect(detailRows.flat()).toContain('Charge')
    expect(detailRows).toContainEqual(['', '', '', '', 'Charge', '2026-03-12', '-', '', 'x', -80, 220])
  })

  it('exports reconciliation detail rows for outstanding and in-transit items', async () => {
    const { exportReconciliationReport, writeFile, xlsx } = await loadSubject()
    const report: ReconciliationReport = {
      account_name: 'Checking',
      account_code: '1000',
      account_type: 'ASSET',
      is_closed: false,
      status: 'BALANCED',
      statement_period_start: '2026-03-01',
      statement_period_end: '2026-03-31',
      reconciliation_date: '2026-04-01T14:30:00.000Z',
      reconciler_name: 'Admin',
      opening_balance: 1000,
      cleared_in: 0,
      cleared_out: 0,
      statement_ending_balance: 1000,
      in_transit: 40,
      outstanding_out: 25,
      adjusted_bank_balance: 1015,
      book_balance: 1015,
      difference: 0,
      cleared_in_items: [],
      cleared_out_items: [],
      in_transit_items: [
        {
          date: '2026-03-20',
          reference_no: 'DEP-1',
          payee: 'Donor',
          description: 'Deposit in transit',
          memo: null,
          amount: 40,
          fund_name: 'General',
        },
      ],
      outstanding_out_items: [
        {
          date: '2026-03-18',
          reference_no: 'CHK-2',
          payee: 'Vendor',
          description: 'Outstanding cheque',
          memo: null,
          amount: 25,
          fund_name: 'General',
        },
      ],
      fund_activity: [],
    }

    exportReconciliationReport(report)

    const workbook = writeFile.mock.calls[0]?.[0] as WorkBook
    const detailRows = sheetRows(xlsx, workbook, 'Detail')

    expect(detailRows).toContainEqual(['', '', '', '', 'Cheque', '2026-03-18', 'CHK-2', 'Vendor', '', -25, 975])
    expect(detailRows).toContainEqual(['', '', '', '', 'Deposit', '2026-03-20', 'DEP-1', 'Donor', '', 40, 1015])
  })
})
