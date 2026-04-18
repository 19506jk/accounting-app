import * as XLSX from 'xlsx';
import Decimal from 'decimal.js';
import { getVisibleTrialBalanceAccounts } from './trialBalanceHelpers';
import type {
  BalanceSheetReportData,
  BalanceSheetReportFilters,
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
} from '@shared/contracts';

type XlsxValue = string | number | boolean | null;
type XlsxRow = XlsxValue[];

function formatReferenceForExport(referenceNo: string | null | undefined) {
  if (referenceNo === null || referenceNo === undefined || referenceNo === '') return '-'
  return `'${String(referenceNo)}`
}

export function exportPL(data: PLReportData, filters: PLReportFilters) {
  const rows: XlsxRow[] = [
    ['Statement of Activities', '', ''],
    [`Period: ${filters.from} to ${filters.to}`, '', ''],
    [],
    ['INCOME', '', ''],
    ...(data.income || []).map((a) => ['', a.name, a.amount]),
    ['', 'Total Income', data.total_income],
    [],
    ['EXPENSES', '', ''],
    ...(data.expenses || []).map((a) => ['', a.name, a.amount]),
    ['', 'Total Expenses', data.total_expenses],
    [],
    ['Net Surplus / (Deficit)', '', data.net_surplus],
  ];
  downloadXlsx(rows, `pl_${filters.from}_${filters.to}.xlsx`, 'P&L');
}

export function exportBalanceSheet(data: BalanceSheetReportData, filters: BalanceSheetReportFilters) {
  const rows: XlsxRow[] = [
    ['Statement of Financial Position', '', ''],
    [`As of: ${filters.as_of}`, '', ''],
    [],
    ['ASSETS', '', ''],
    ...(data.assets || []).map((a) => ['', a.name, a.balance]),
    ['', 'Total Assets', data.total_assets],
    [],
    ['LIABILITIES', '', ''],
    ...(data.liabilities || []).map((a) => ['', a.name, a.balance]),
    ['', 'Total Liabilities', data.total_liabilities],
    [],
    ['EQUITY', '', ''],
    ...(data.equity || []).map((a) => ['', a.name, a.balance]),
    ['', 'Total Equity', data.total_equity],
    [],
    ['Total Liabilities + Equity', '', data.total_liabilities_and_equity],
    ['Balanced', '', data.is_balanced ? 'YES' : 'NO'],
  ];
  downloadXlsx(rows, `balance_sheet_${filters.as_of}.xlsx`, 'Balance Sheet');
}

export function exportLedger(data: LedgerReportData, filters: LedgerReportFilters) {
  const headers = ['Date', 'Reference No', 'Description', 'Contact', 'Fund', 'Debit', 'Credit', 'Balance']
  const rows: XlsxRow[] = [
    ['General Ledger', '', '', '', '', '', '', ''],
    [`Period: ${filters.from} to ${filters.to}`, '', '', '', '', '', '', ''],
    [],
  ];
  (data.ledger || []).forEach((acct) => {
    rows.push([`${acct.account.code} — ${acct.account.name}`, '', '', '', '', '', '', '']);
    rows.push(headers);
    rows.push(['Opening Balance', '', '', '', '', '', '', acct.opening_balance]);
    acct.rows.forEach((r) => rows.push([
      r.date,
      formatReferenceForExport(r.reference_no),
      r.description,
      r.contact_name || 'Unassigned',
      r.fund_name,
      r.debit || '',
      r.credit || '',
      r.balance,
    ]));
    rows.push(['Closing Balance', '', '', '', '', '', '', acct.closing_balance]);
    rows.push([]);
  });
  const cols = [
    { wch: 12 },
    { wch: 18 },
    { wch: 28 },
    { wch: 26 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
  ];
  downloadXlsx(rows, `ledger_${filters.from}_${filters.to}.xlsx`, 'General Ledger', cols);
}

export function exportTrialBalance(data: TrialBalanceReportData, filters: TrialBalanceReportFilters) {
  const orderedAccounts = getVisibleTrialBalanceAccounts(data.accounts || [])
  const rows: XlsxRow[] = [
    ['Trial Balance', '', '', ''],
    [`As of: ${filters.as_of}`, '', '', ''],
    [],
    ['Code', 'Account', 'Debit', 'Credit'],
    ...orderedAccounts.map((a) => [
      a.code,
      `${a.name}${a.is_synthetic ? ' [Synthetic]' : ''}`,
      a.net_debit,
      a.net_credit,
    ]),
    [],
    ['TOTALS', '', data.grand_total_debit, data.grand_total_credit],
    ['Balanced', '', '', data.is_balanced ? 'YES' : 'NO'],
  ];

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)

  orderedAccounts.forEach((account, index) => {
    if (!account?.is_synthetic) return
    const cellAddress = XLSX.utils.encode_cell({ r: 4 + index, c: 1 })
    if (!ws[cellAddress]) return
    const currentStyle = ws[cellAddress].s || {}
    const currentAlignment = currentStyle.alignment || {}
    ws[cellAddress].s = {
      ...currentStyle,
      alignment: {
        ...currentAlignment,
        indent: 2,
      },
    }
  })

  XLSX.utils.book_append_sheet(wb, ws, 'Trial Balance')
  XLSX.writeFile(wb, `trial_balance_${filters.as_of}.xlsx`)
}

export function exportDonorSummary(data: DonorSummaryReportData, filters: DonorSummaryReportFilters) {
  const rows: XlsxRow[] = [
    ['Income by Donor — Summary', '', '', ''],
    [`Period: ${filters.from} to ${filters.to}`, '', '', ''],
    [],
    ['Donor', 'Donations', 'Total'],
    ...(data.donors || []).map((d) => [d.contact_name, d.transaction_count, d.total]),
    ['Anonymous', '', data.anonymous?.transaction_count || 0, data.anonymous?.total || 0],
    [],
    ['Grand Total', '', '', data.grand_total],
  ];
  downloadXlsx(rows, `donor_summary_${filters.from}_${filters.to}.xlsx`, 'Donor Summary');
}

export function exportDonorDetail(data: DonorDetailReportData, filters: DonorDetailReportFilters) {
  const rows: XlsxRow[] = [
    ['Income by Donor — Detail', '', '', '', ''],
    [`Period: ${filters.from} to ${filters.to}`, '', '', '', ''],
    [],
  ];
  (data.donors || []).forEach((d) => {
    rows.push([d.contact_name, '', '', '', '']);
    rows.push(['Date', 'Description', 'Account', 'Fund', 'Amount']);
    (d.transactions || []).forEach((tx) => rows.push([tx.date, tx.description, tx.account_name, tx.fund_name, tx.amount]));
    rows.push(['Subtotal', '', '', '', d.total]);
    rows.push([]);
  });
  if (data.anonymous?.transactions?.length) {
    rows.push(['Anonymous', '', '', '', '']);
    data.anonymous.transactions.forEach((tx) => rows.push([tx.date, tx.description, tx.account_name, tx.fund_name, tx.amount]));
    rows.push(['Subtotal', '', '', '', data.anonymous.total]);
    rows.push([]);
  }
  rows.push(['Grand Total', '', '', '', data.grand_total]);
  downloadXlsx(rows, `donor_detail_${filters.from}_${filters.to}.xlsx`, 'Donor Detail');
}

function getQbLabels(accountType: ReconciliationReport['account_type']) {
  if (accountType === 'ASSET') {
    return {
      clearedOut: 'Cheques and Payments',
      clearedIn: 'Deposits and Credits',
      outstandingOut: 'Outstanding Payments',
      inTransit: 'Deposits In Transit',
      outType: 'Cheque',
      inType: 'Deposit',
    }
  }
  return {
    clearedOut: 'Charges',
    clearedIn: 'Receipts',
    outstandingOut: 'Outstanding Charges',
    inTransit: 'Receipts In Transit',
    outType: 'Charge',
    inType: 'Receipt',
  }
}

function formatQbDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  const [year, month, day] = parts as [string, string, string]
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthLabel = months[Number(month) - 1]
  if (!monthLabel) return dateStr
  return `${Number(day)} ${monthLabel} ${year.slice(2)}`
}

function formatReportDateTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp)
  if (Number.isNaN(d.getTime())) return ''
  const hours = d.getHours() % 12 || 12
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const ampm = d.getHours() < 12 ? 'AM' : 'PM'
  return `${hours}:${minutes} ${ampm}`
}

const dec = (n: number) => new Decimal(n)

export function exportReconciliationReport(report: ReconciliationReport): void {
  const labels = getQbLabels(report.account_type)
  const clearedNet = dec(report.cleared_in).minus(report.cleared_out)
  const clearedBalance = dec(report.opening_balance).plus(clearedNet)
  const unclearedNet = dec(report.in_transit).minus(report.outstanding_out)
  const registerNet = dec(report.book_balance).minus(report.opening_balance)
  const reportTime = formatReportDateTime(report.reconciliation_date)
  const statementDate = formatQbDate(report.statement_period_end)
  const accountLabel = `${report.account_code} ${report.account_name}`
  const periodLabel = `${report.account_code}-${report.account_name}, Period Ending ${report.statement_period_end}`

  const summaryRows: XlsxRow[] = [
    [accountLabel, '', '', '', reportTime],
    ['Reconciliation Summary', '', '', '', statementDate],
    [periodLabel, '', '', '', ''],
    [],
    ['', '', '', '', statementDate],
    ['Beginning Balance', '', '', '', report.opening_balance],
    ['', 'Cleared Transactions', '', '', ''],
    ['', '', `${labels.clearedOut} - ${report.cleared_out_items.length} items`, '', Number(dec(report.cleared_out).negated())],
    ['', '', `${labels.clearedIn} - ${report.cleared_in_items.length} items`, '', report.cleared_in],
    ['', 'Total Cleared Transactions', '', '', Number(clearedNet)],
    ['Cleared Balance', '', '', '', Number(clearedBalance)],
    ['', 'Uncleared Transactions', '', '', ''],
    ['', '', `${labels.outstandingOut} - ${report.outstanding_out_items.length} items`, '', Number(dec(report.outstanding_out).negated())],
    ['', '', `${labels.inTransit} - ${report.in_transit_items.length} items`, '', report.in_transit],
    ['', 'Total Uncleared Transactions', '', '', Number(unclearedNet)],
    [`Register Balance as of ${report.statement_period_end}`, '', '', '', report.book_balance],
    ['Ending Balance', '', '', '', report.book_balance],
  ]

  const detailRows: XlsxRow[] = [
    [accountLabel, '', '', '', '', '', '', '', '', '', reportTime],
    ['Reconciliation Detail', '', '', '', '', '', '', '', '', '', statementDate],
    [periodLabel, '', '', '', '', '', '', '', '', '', ''],
    [],
    ['', '', '', '', 'Type', 'Date', 'Num', 'Name', 'Clr', 'Amount', 'Balance'],
    ['Beginning Balance', '', '', '', '', '', '', '', '', '', report.opening_balance],
  ]

  let running = dec(report.opening_balance)

  detailRows.push(['', '', 'Cleared Transactions', '', '', '', '', '', '', '', ''])
  detailRows.push(['', '', '', `${labels.clearedOut} - ${report.cleared_out_items.length} items`, '', '', '', '', '', '', ''])
  report.cleared_out_items.forEach((item) => {
    const signedAmount = dec(item.amount).negated()
    running = running.plus(signedAmount)
    detailRows.push([
      '',
      '',
      '',
      '',
      labels.outType,
      item.date,
      formatReferenceForExport(item.reference_no),
      item.payee || '',
      'x',
      Number(signedAmount),
      Number(running),
    ])
  })
  detailRows.push(['', '', '', `Total ${labels.clearedOut}`, '', '', '', '', '', Number(dec(report.cleared_out).negated()), Number(running)])

  detailRows.push(['', '', '', `${labels.clearedIn} - ${report.cleared_in_items.length} items`, '', '', '', '', '', '', ''])
  report.cleared_in_items.forEach((item) => {
    const signedAmount = dec(item.amount)
    running = running.plus(signedAmount)
    detailRows.push([
      '',
      '',
      '',
      '',
      labels.inType,
      item.date,
      formatReferenceForExport(item.reference_no),
      item.payee || '',
      'x',
      Number(item.amount),
      Number(running),
    ])
  })
  detailRows.push(['', '', '', `Total ${labels.clearedIn}`, '', '', '', '', '', report.cleared_in, Number(running)])
  detailRows.push(['', '', 'Total Cleared Transactions', '', '', '', '', '', '', Number(clearedNet), Number(running)])
  detailRows.push(['Cleared Balance', '', '', '', '', '', '', '', '', Number(clearedNet), Number(clearedBalance)])

  detailRows.push(['', '', 'Uncleared Transactions', '', '', '', '', '', '', '', ''])
  detailRows.push(['', '', '', `${labels.outstandingOut} - ${report.outstanding_out_items.length} items`, '', '', '', '', '', '', ''])
  report.outstanding_out_items.forEach((item) => {
    const signedAmount = dec(item.amount).negated()
    running = running.plus(signedAmount)
    detailRows.push([
      '',
      '',
      '',
      '',
      labels.outType,
      item.date,
      formatReferenceForExport(item.reference_no),
      item.payee || '',
      '',
      Number(signedAmount),
      Number(running),
    ])
  })
  detailRows.push(['', '', '', `Total ${labels.outstandingOut}`, '', '', '', '', '', Number(dec(report.outstanding_out).negated()), Number(running)])

  detailRows.push(['', '', '', `${labels.inTransit} - ${report.in_transit_items.length} items`, '', '', '', '', '', '', ''])
  report.in_transit_items.forEach((item) => {
    const signedAmount = dec(item.amount)
    running = running.plus(signedAmount)
    detailRows.push([
      '',
      '',
      '',
      '',
      labels.inType,
      item.date,
      formatReferenceForExport(item.reference_no),
      item.payee || '',
      '',
      item.amount,
      Number(running),
    ])
  })
  detailRows.push(['', '', '', `Total ${labels.inTransit}`, '', '', '', '', '', report.in_transit, Number(running)])
  detailRows.push(['', '', 'Total Uncleared Transactions', '', '', '', '', '', '', Number(unclearedNet), Number(running)])
  detailRows.push([`Register Balance as of ${report.statement_period_end}`, '', '', '', '', '', '', '', '', Number(registerNet), report.book_balance])
  detailRows.push(['Ending Balance', '', '', '', '', '', '', '', '', Number(registerNet), report.book_balance])

  const wb = XLSX.utils.book_new()
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows)

  summarySheet['!cols'] = [{ wch: 40 }, { wch: 30 }, { wch: 30 }, { wch: 12 }, { wch: 16 }]
  detailSheet['!cols'] = [
    { wch: 30 },
    { wch: 4 },
    { wch: 26 },
    { wch: 30 },
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
    { wch: 24 },
    { wch: 6 },
    { wch: 14 },
    { wch: 14 },
  ]

  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Detail')
  XLSX.writeFile(wb, `reconciliation_report_${report.account_code}_${report.statement_period_end}.xlsx`)
}

function downloadXlsx(rows: XlsxRow[], filename: string, sheetName: string, cols: XLSX.ColInfo[] | null = null) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (cols) ws['!cols'] = cols;
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
