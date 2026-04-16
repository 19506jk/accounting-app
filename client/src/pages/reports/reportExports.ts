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
  TrialBalanceReportData,
  TrialBalanceReportFilters,
} from '@shared/contracts';

type XlsxValue = string | number | boolean | null;
type XlsxRow = XlsxValue[];

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
  const formatReferenceForExport = (referenceNo: string | null | undefined) => {
    if (referenceNo === null || referenceNo === undefined || referenceNo === '') return '-'
    return `'${String(referenceNo)}`
  }

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

function downloadXlsx(rows: XlsxRow[], filename: string, sheetName: string, cols: XLSX.ColInfo[] | null = null) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (cols) ws['!cols'] = cols;
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
