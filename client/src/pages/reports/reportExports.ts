import * as XLSX from 'xlsx';
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
  ReconciliationReportItem,
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

function getReconciliationStatusLabel(report: ReconciliationReport) {
  if (report.is_closed && report.status === 'BALANCED') return 'FINAL - BALANCED'
  if (report.is_closed && report.status === 'UNBALANCED') return 'CLOSED - UNBALANCED (REVIEW REQUIRED)'
  if (!report.is_closed && report.status === 'BALANCED') return 'IN PROGRESS - BALANCED (NOT YET CLOSED)'
  return 'IN PROGRESS - UNBALANCED'
}

function getReconciliationSectionLabels(accountType: ReconciliationReport['account_type']) {
  if (accountType === 'ASSET') {
    return {
      clearedIn: 'Cleared Deposits',
      clearedOut: 'Cleared Payments',
      inTransit: 'Deposits In Transit',
      outstandingOut: 'Outstanding Payments',
    }
  }
  return {
    clearedIn: 'Cleared Receipts',
    clearedOut: 'Cleared Charges',
    inTransit: 'Receipts In Transit',
    outstandingOut: 'Outstanding Charges',
  }
}

function sumAmounts(items: Array<{ amount: number }>) {
  return items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
}

export function exportReconciliationReport(report: ReconciliationReport): void {
  const labels = getReconciliationSectionLabels(report.account_type)
  const summaryRows: XlsxRow[] = [
    ['Reconciliation Report', '', '', ''],
    [getReconciliationStatusLabel(report), '', '', ''],
    [],
    ['Account', `${report.account_code} - ${report.account_name}`, '', ''],
    ['Statement Period', report.statement_period_start
      ? `${report.statement_period_start} to ${report.statement_period_end}`
      : `Up to ${report.statement_period_end}`, '', ''],
    ['Reconciliation Date', report.reconciliation_date, '', ''],
    ['Reconciler', report.reconciler_name || 'Unknown', '', ''],
    [],
    ['Bridge', '', '', ''],
    ['Opening Balance', report.opening_balance, '', ''],
    ['Cleared In', report.cleared_in, '', ''],
    ['Cleared Out', report.cleared_out, '', ''],
    ['Statement Ending Balance', report.statement_ending_balance, '', ''],
    ['In Transit', report.in_transit, '', ''],
    ['Outstanding Out', report.outstanding_out, '', ''],
    ['Adjusted Bank Balance', report.adjusted_bank_balance, '', ''],
    ['Book Balance', report.book_balance, '', ''],
    ['Difference', report.difference, '', ''],
    [],
    ['Fund Activity of Listed Items', '', '', ''],
    ['Fund', 'Net Activity', '', ''],
    ...(report.fund_activity || []).map((fund) => [fund.fund_name, fund.net_activity, '', '']),
    ...(report.fund_activity?.length ? [] : [['No items', 0, '', '']]),
    [],
    ['Note', 'Represents all items listed in this reconciliation, including carried-forward outstanding items.', '', ''],
  ]

  const detailRows: XlsxRow[] = [
    ['Reconciliation Detail', '', '', '', '', '', '', ''],
    ['Section', 'Date', 'Ref #', 'Payee', 'Description', 'Memo', 'Fund', 'Amount'],
  ]

  const pushSection = (title: string, items: ReconciliationReportItem[]) => {
    detailRows.push([title, '', '', '', '', '', '', ''])
    detailRows.push(['', 'Date', 'Ref #', 'Payee', 'Description', 'Memo', 'Fund', 'Amount'])
    items.forEach((item) => {
      detailRows.push([
        '',
        item.date,
        formatReferenceForExport(item.reference_no),
        item.payee || '',
        item.description,
        item.memo || '',
        item.fund_name,
        item.amount,
      ])
    })
    detailRows.push(['', '', '', '', '', '', 'Subtotal', sumAmounts(items)])
    detailRows.push([])
  }

  pushSection(labels.clearedIn, report.cleared_in_items)
  pushSection(labels.clearedOut, report.cleared_out_items)
  pushSection(labels.inTransit, report.in_transit_items)
  pushSection(labels.outstandingOut, report.outstanding_out_items)

  const wb = XLSX.utils.book_new()
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows)

  summarySheet['!cols'] = [{ wch: 40 }, { wch: 40 }, { wch: 12 }, { wch: 12 }]
  detailSheet['!cols'] = [
    { wch: 30 },
    { wch: 12 },
    { wch: 18 },
    { wch: 24 },
    { wch: 30 },
    { wch: 22 },
    { wch: 18 },
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
