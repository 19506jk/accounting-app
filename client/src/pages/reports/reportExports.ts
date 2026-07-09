import Decimal from 'decimal.js';
import { getVisibleTrialBalanceAccounts } from './trialBalanceHelpers';
import { REPORT_META } from './reportMetadata';
import {
  addSheetToWorkbook,
  createWorkbook,
  downloadWorkbook,
  type ColumnConfig,
  type XlsxValue,
} from './excelExportHelper';
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
} from '@shared/contracts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatReferenceForExport(referenceNo: string | null | undefined) {
  if (referenceNo === null || referenceNo === undefined || referenceNo === '') return '-';
  return String(referenceNo);
}

const dec = (n: number) => new Decimal(n);

// Amount column for numeric values; text column for labels
const AMT: ColumnConfig = { type: 'amount' };
const TXT: ColumnConfig = { type: 'text' };

// ---------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------

export async function exportPL(
  data: PLReportData,
  filters: PLReportFilters,
): Promise<void> {
  const meta = REPORT_META['pl'];
  const cols: (ColumnConfig | null)[] = [TXT, TXT, AMT];
  const filename = `${meta.filenamePrefix}_${filters.from}_${filters.to}.xlsx`;

  const wb = await createWorkbook();
  addSheetToWorkbook(wb, meta.tabName, 3, cols, (b) => {
    b.title(meta.title);
    b.metadata(`Period: ${filters.from} to ${filters.to}`);
    b.blankRow();

    // Income section
    b.sectionHeader('Income');
    (data.income || []).forEach((a) =>
      b.dataRow(['', `${a.code} - ${a.name}`, a.amount]),
    );
    b.totalRow(['', 'Total Income', data.total_income]);
    b.blankRow();

    // Expenses section
    b.sectionHeader('Expenses');
    (data.expenses || []).forEach((a) =>
      b.dataRow(['', `${a.code} - ${a.name}`, a.amount]),
    );
    b.totalRow(['', 'Total Expenses', data.total_expenses]);
    b.blankRow();

    b.totalRow(['Net Surplus / (Deficit)', '', data.net_surplus], {
      grandTotal: true,
    });
  });

  await downloadWorkbook(wb, filename);
}

// ---------------------------------------------------------------------------
// Balance Sheet
// ---------------------------------------------------------------------------

export async function exportBalanceSheet(
  data: BalanceSheetReportData,
  filters: BalanceSheetReportFilters,
): Promise<void> {
  const meta = REPORT_META['balance-sheet'];
  const cols: (ColumnConfig | null)[] = [TXT, TXT, AMT];
  const filename = `${meta.filenamePrefix}_${filters.as_of}.xlsx`;

  const wb = await createWorkbook();
  addSheetToWorkbook(wb, meta.tabName, 3, cols, (b) => {
    b.title(meta.title);
    b.metadata(`As of: ${filters.as_of}`);
    b.blankRow();

    // Assets
    b.sectionHeader('Assets');
    (data.assets || []).forEach((a) => b.dataRow(['', a.name, a.balance]));
    b.totalRow(['', 'Total Assets', data.total_assets]);
    b.blankRow();

    // Liabilities
    b.sectionHeader('Liabilities');
    (data.liabilities || []).forEach((a) => b.dataRow(['', a.name, a.balance]));
    b.totalRow(['', 'Total Liabilities', data.total_liabilities]);
    b.blankRow();

    // Equity
    b.sectionHeader('Equity');
    (data.equity || []).forEach((a) => b.dataRow(['', a.name, a.balance]));
    b.totalRow(['', 'Total Equity', data.total_equity]);
    b.blankRow();

    b.totalRow(
      ['Total Liabilities + Equity', '', data.total_liabilities_and_equity],
      { grandTotal: true },
    );
    b.statusRow(['Balanced', '', data.is_balanced ? 'YES' : 'NO']);
  });

  await downloadWorkbook(wb, filename);
}

// ---------------------------------------------------------------------------
// General Ledger
// ---------------------------------------------------------------------------

export async function exportLedger(
  data: LedgerReportData,
  filters: LedgerReportFilters,
): Promise<void> {
  const meta = REPORT_META['ledger'];
  const cols: (ColumnConfig | null)[] = [
    TXT, TXT, TXT, TXT, TXT, AMT, AMT, AMT,
  ];
  const colWidths = [12, 18, 28, 26, 18, 14, 14, 14];
  const filename = `${meta.filenamePrefix}_${filters.from}_${filters.to}.xlsx`;

  const headers: (string | null)[] = [
    'Date', 'Reference No', 'Description', 'Contact', 'Fund',
    'Debit', 'Credit', 'Balance',
  ];

  const wb = await createWorkbook();
  addSheetToWorkbook(wb, meta.tabName, 8, cols, (b) => {
    b.title(meta.title);
    b.metadata(`Period: ${filters.from} to ${filters.to}`);
    b.blankRow();

    (data.ledger || []).forEach((acct) => {
      // Account section header
      b.sectionHeader(`${acct.account.code} — ${acct.account.name}`);
      b.headerRow(headers);
      b.dataRow([
        'Opening Balance', '', '', '', '', '', '', acct.opening_balance,
      ]);

      acct.rows.forEach((r) =>
        b.dataRow([
          r.date,
          formatReferenceForExport(r.reference_no),
          r.description,
          r.contact_name || 'Unassigned',
          r.fund_name,
          r.debit || '',
          r.credit || '',
          r.balance,
        ]),
      );

      b.totalRow([
        'Closing Balance', '', '', '', '', '', '', acct.closing_balance,
      ]);
      b.blankRow();
    });
  }, colWidths);

  // Freeze below the common header area (title + metadata + blank row)
  // We apply freeze manually *after* the build because every account group
  // repeats headers, so we only freeze the very first header row.
  {
    const ws = wb.getWorksheet(meta.tabName);
    if (ws) {
      ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }];
    }
  }

  await downloadWorkbook(wb, filename);
}

// ---------------------------------------------------------------------------
// Trial Balance
// ---------------------------------------------------------------------------

export async function exportTrialBalance(
  data: TrialBalanceReportData,
  filters: TrialBalanceReportFilters,
): Promise<void> {
  const meta = REPORT_META['trial-balance'];
  const cols: (ColumnConfig | null)[] = [TXT, TXT, AMT, AMT];
  const colWidths = [14, 44, 14, 14];
  const filename = `${meta.filenamePrefix}_${filters.as_of}.xlsx`;

  const orderedAccounts = getVisibleTrialBalanceAccounts(data.accounts || []);

  const wb = await createWorkbook();
  addSheetToWorkbook(wb, meta.tabName, 4, cols, (b) => {
    b.title(meta.title);
    b.metadata(`As of: ${filters.as_of}`);
    b.blankRow();

    b.headerRow(['Code', 'Account', 'Debit', 'Credit']);

    orderedAccounts.forEach((a) => {
      const indent = a.is_synthetic ? 2 : undefined;
      b.dataRow(
        [
          a.code,
          `${a.name}${a.is_synthetic ? ' [Synthetic]' : ''}`,
          a.net_debit,
          a.net_credit,
        ],
        indent !== undefined ? { indentCol: 1, indent } : undefined,
      );
    });

    b.blankRow();
    b.totalRow([
      'TOTALS', '', data.grand_total_debit, data.grand_total_credit,
    ]);
    b.statusRow(['Balanced', '', '', data.is_balanced ? 'YES' : 'NO']);
  }, colWidths);

  await downloadWorkbook(wb, filename);
}

// ---------------------------------------------------------------------------
// Donor Summary
// ---------------------------------------------------------------------------

export async function exportDonorSummary(
  data: DonorSummaryReportData,
  filters: DonorSummaryReportFilters,
): Promise<void> {
  const meta = REPORT_META['donors-summary'];
  // 4 columns: donor name, donation count, spacer, total amount
  const cols: (ColumnConfig | null)[] = [TXT, TXT, TXT, AMT];
  const colWidths = [28, 14, 8, 16];
  const filename = `${meta.filenamePrefix}_${filters.from}_${filters.to}.xlsx`;

  const wb = await createWorkbook();
  addSheetToWorkbook(wb, meta.tabName, 4, cols, (b) => {
    b.title(meta.title);
    b.metadata(`Period: ${filters.from} to ${filters.to}`);
    b.blankRow();

    b.headerRow(['Donor', 'Donations', '', 'Total']);

    (data.donors || []).forEach((d) =>
      b.dataRow([d.contact_name, d.transaction_count, '', d.total]),
    );

    // Anonymous row — same column order as Donor | Donations | <spacer> | Total
    b.dataRow([
      'Anonymous',
      data.anonymous?.transaction_count || 0,
      '',
      data.anonymous?.total || 0,
    ]);

    b.blankRow();
    b.totalRow(['Grand Total', '', '', data.grand_total], {
      grandTotal: true,
    });
  }, colWidths);

  await downloadWorkbook(wb, filename);
}

// ---------------------------------------------------------------------------
// Donor Detail
// ---------------------------------------------------------------------------

export async function exportDonorDetail(
  data: DonorDetailReportData,
  filters: DonorDetailReportFilters,
): Promise<void> {
  const meta = REPORT_META['donors-detail'];
  const cols: (ColumnConfig | null)[] = [TXT, TXT, TXT, TXT, AMT];
  const colWidths = [12, 28, 20, 16, 14];
  const filename = `${meta.filenamePrefix}_${filters.from}_${filters.to}.xlsx`;

  const txHeaders: (string | null)[] = [
    'Date', 'Description', 'Account', 'Fund', 'Amount',
  ];

  const wb = await createWorkbook();
  addSheetToWorkbook(wb, meta.tabName, 5, cols, (b) => {
    b.title(meta.title);
    b.metadata(`Period: ${filters.from} to ${filters.to}`);
    b.blankRow();

    (data.donors || []).forEach((d) => {
      b.sectionHeader(d.contact_name);
      b.headerRow(txHeaders);
      (d.transactions || []).forEach((tx) =>
        b.dataRow([
          tx.date,
          tx.description,
          tx.account_name,
          tx.fund_name,
          tx.amount,
        ]),
      );
      b.totalRow(['Subtotal', '', '', '', d.total]);
      b.blankRow();
    });

    // Anonymous section
    if (data.anonymous?.transactions?.length) {
      b.sectionHeader('Anonymous');
      data.anonymous.transactions.forEach((tx) =>
        b.dataRow([
          tx.date,
          tx.description,
          tx.account_name,
          tx.fund_name,
          tx.amount,
        ]),
      );
      b.totalRow(['Subtotal', '', '', '', data.anonymous.total]);
      b.blankRow();
    }

    b.totalRow(['Grand Total', '', '', '', data.grand_total], {
      grandTotal: true,
    });
  }, colWidths);

  await downloadWorkbook(wb, filename);
}

// ---------------------------------------------------------------------------
// Contacts — stays on xlsx/writeFile path, but xlsx is lazy-loaded so the
// main report bundle does not pay for the library.
// ---------------------------------------------------------------------------

interface ColInfo {
  wch?: number;
}

export async function exportContacts(contacts: ContactSummary[]) {
  const active = contacts.filter((c) => c.is_active);
  const rows: XlsxValue[][] = [
    ['Contacts & Donors'],
    [`Exported: ${new Date().toISOString().slice(0, 10)}`],
    [],
    [
      'Donor ID', 'Name', 'First Name', 'Last Name', 'Email', 'Phone',
      'Address Line 1', 'Address Line 2', 'City', 'Province', 'Postal Code',
    ],
    ...active.map((c) => [
      c.donor_id || '',
      c.name,
      c.first_name || '',
      c.last_name || '',
      c.email || '',
      c.phone || '',
      c.address_line1 || '',
      c.address_line2 || '',
      c.city || '',
      c.province || '',
      c.postal_code || '',
    ]),
  ];
  const cols: ColInfo[] = [
    { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 16 },
    { wch: 28 }, { wch: 16 }, { wch: 28 }, { wch: 20 },
    { wch: 16 }, { wch: 10 }, { wch: 14 },
  ];
  await downloadXlsx(
    rows,
    `contacts_${new Date().toISOString().slice(0, 10)}.xlsx`,
    'Contacts',
    cols,
  );
}

// ---------------------------------------------------------------------------
// Reconciliation labels (unchanged)
// ---------------------------------------------------------------------------

function getQbLabels(accountType: ReconciliationReport['account_type']) {
  if (accountType === 'ASSET') {
    return {
      clearedOut: 'Cheques and Payments',
      clearedIn: 'Deposits and Credits',
      outstandingOut: 'Outstanding Payments',
      inTransit: 'Deposits In Transit',
      outType: 'Cheque',
      inType: 'Deposit',
    };
  }
  return {
    clearedOut: 'Charges',
    clearedIn: 'Receipts',
    outstandingOut: 'Outstanding Charges',
    inTransit: 'Receipts In Transit',
    outType: 'Charge',
    inType: 'Receipt',
  };
}

export function formatReconciliationAccountTitle(report: {
  account_code: string;
  account_name: string;
}): string {
  return `${report.account_code} — ${report.account_name}`;
}

export function formatReconciliationWorkspaceHeader(report: {
  account_name: string;
  statement_date: string;
}): string {
  return `${report.account_name} — ${report.statement_date}`;
}

function formatQbDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts as [string, string, string];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const monthLabel = months[Number(month) - 1];
  if (!monthLabel) return dateStr;
  return `${Number(day)} ${monthLabel} ${year.slice(2)}`;
}

function formatReportDateTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '';
  const hours = d.getHours() % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${hours}:${minutes} ${ampm}`;
}

// ---------------------------------------------------------------------------
// Reconciliation Report
// ---------------------------------------------------------------------------

export async function exportReconciliationReport(
  report: ReconciliationReport,
): Promise<void> {
  const labels = getQbLabels(report.account_type);
  const clearedNet = dec(report.cleared_in).minus(report.cleared_out);
  const clearedBalance = dec(report.opening_balance).plus(clearedNet);
  const unclearedNet = dec(report.in_transit).minus(report.outstanding_out);
  const registerNet = dec(report.book_balance).minus(report.opening_balance);
  const reportTime = formatReportDateTime(report.reconciliation_date);
  const statementDate = formatQbDate(report.statement_period_end);
  const accountLabel = formatReconciliationAccountTitle(report);
  const periodLabel = `${report.account_code}-${report.account_name}, Period Ending ${report.statement_period_end}`;

  const filename = `reconciliation_report_${report.account_code}_${report.statement_period_end}.xlsx`;

  // ---- Summary sheet ---------------------------------------------------
  const summaryCols: (ColumnConfig | null)[] = [TXT, TXT, TXT, TXT, AMT];
  const summaryWidths = [40, 30, 30, 12, 16];

  const wb = await createWorkbook();

  addSheetToWorkbook(wb, 'Summary', 5, summaryCols, (b) => {
    b.title(accountLabel);
    b.dataRow(['Reconciliation Summary', '', '', '', reportTime]);
    b.dataRow([periodLabel, '', '', '', statementDate]);
    b.blankRow();

    b.dataRow(['Beginning Balance', '', '', '', report.opening_balance]);

    // Cleared transactions
    b.sectionHeader('Cleared Transactions');
    b.dataRow([
      '',
      `${labels.clearedOut} - ${report.cleared_out_items.length} items`,
      '',
      '',
      Number(dec(report.cleared_out).negated()),
    ]);
    b.dataRow([
      '',
      `${labels.clearedIn} - ${report.cleared_in_items.length} items`,
      '',
      '',
      report.cleared_in,
    ]);
    b.totalRow(['', 'Total Cleared Transactions', '', '', Number(clearedNet)]);
    b.totalRow(['Cleared Balance', '', '', '', Number(clearedBalance)]);

    // Uncleared transactions
    b.sectionHeader('Uncleared Transactions');
    b.dataRow([
      '',
      `${labels.outstandingOut} - ${report.outstanding_out_items.length} items`,
      '',
      '',
      Number(dec(report.outstanding_out).negated()),
    ]);
    b.dataRow([
      '',
      `${labels.inTransit} - ${report.in_transit_items.length} items`,
      '',
      '',
      report.in_transit,
    ]);
    b.totalRow([
      '', 'Total Uncleared Transactions', '', '', Number(unclearedNet),
    ]);

    b.totalRow([
      `Register Balance as of ${report.statement_period_end}`,
      '', '', '', report.book_balance,
    ]);
    b.totalRow(['Ending Balance', '', '', '', report.book_balance], {
      grandTotal: true,
    });
  }, summaryWidths);

  // ---- Detail sheet ---------------------------------------------------
  const detailCols: (ColumnConfig | null)[] = [
    TXT, TXT, TXT, TXT, TXT, TXT, TXT, TXT, TXT, AMT, AMT,
  ];
  const detailWidths = [30, 4, 26, 30, 16, 12, 18, 24, 6, 14, 14];

  addSheetToWorkbook(wb, 'Detail', 11, detailCols, (b) => {
    b.title(accountLabel);
    b.dataRow(['Reconciliation Detail', '', '', '', '', '', '', '', '', '', reportTime]);
    b.dataRow([periodLabel, '', '', '', '', '', '', '', '', '', statementDate]);
    b.blankRow();

    b.headerRow([
      '', '', '', '', 'Type', 'Date', 'Num', 'Name', 'Clr', 'Amount', 'Balance',
    ]);
    b.dataRow([
      'Beginning Balance', '', '', '', '', '', '', '', '', '', report.opening_balance,
    ]);

    // Running balance tracker
    let running = dec(report.opening_balance);

    // ---- Cleared out
    b.sectionHeader('Cleared Transactions');
    b.dataRow([
      '', '', `${labels.clearedOut} - ${report.cleared_out_items.length} items`,
      '', '', '', '', '', '', '', '',
    ]);

    report.cleared_out_items.forEach((item) => {
      const signedAmount = dec(item.amount).negated();
      running = running.plus(signedAmount);
      b.dataRow([
        '', '', '', '',
        labels.outType,
        item.date,
        formatReferenceForExport(item.reference_no),
        item.payee || '',
        'x',
        Number(signedAmount),
        Number(running),
      ]);
    });
    b.totalRow([
      '', '', '', `Total ${labels.clearedOut}`,
      '', '', '', '', '',
      Number(dec(report.cleared_out).negated()),
      Number(running),
    ]);

    // ---- Cleared in
    b.dataRow([
      '', '', '', `${labels.clearedIn} - ${report.cleared_in_items.length} items`,
      '', '', '', '', '', '', '',
    ]);
    report.cleared_in_items.forEach((item) => {
      const signedAmount = dec(item.amount);
      running = running.plus(signedAmount);
      b.dataRow([
        '', '', '', '',
        labels.inType,
        item.date,
        formatReferenceForExport(item.reference_no),
        item.payee || '',
        'x',
        item.amount,
        Number(running),
      ]);
    });
    b.totalRow([
      '', '', '', `Total ${labels.clearedIn}`,
      '', '', '', '', '',
      report.cleared_in,
      Number(running),
    ]);

    b.totalRow([
      '', '', 'Total Cleared Transactions',
      '', '', '', '', '', '',
      Number(clearedNet),
      Number(running),
    ]);
    b.totalRow([
      'Cleared Balance', '', '', '',
      '', '', '', '', '',
      Number(clearedNet),
      Number(clearedBalance),
    ]);

    // ---- Uncleared
    b.sectionHeader('Uncleared Transactions');

    b.dataRow([
      '', '', '', `${labels.outstandingOut} - ${report.outstanding_out_items.length} items`,
      '', '', '', '', '', '', '',
    ]);
    report.outstanding_out_items.forEach((item) => {
      const signedAmount = dec(item.amount).negated();
      running = running.plus(signedAmount);
      b.dataRow([
        '', '', '', '',
        labels.outType,
        item.date,
        formatReferenceForExport(item.reference_no),
        item.payee || '',
        '',
        Number(signedAmount),
        Number(running),
      ]);
    });
    b.totalRow([
      '', '', '', `Total ${labels.outstandingOut}`,
      '', '', '', '', '',
      Number(dec(report.outstanding_out).negated()),
      Number(running),
    ]);

    b.dataRow([
      '', '', '', `${labels.inTransit} - ${report.in_transit_items.length} items`,
      '', '', '', '', '', '', '',
    ]);
    report.in_transit_items.forEach((item) => {
      const signedAmount = dec(item.amount);
      running = running.plus(signedAmount);
      b.dataRow([
        '', '', '', '',
        labels.inType,
        item.date,
        formatReferenceForExport(item.reference_no),
        item.payee || '',
        '',
        item.amount,
        Number(running),
      ]);
    });
    b.totalRow([
      '', '', '', `Total ${labels.inTransit}`,
      '', '', '', '', '',
      report.in_transit,
      Number(running),
    ]);

    b.totalRow([
      '', '', 'Total Uncleared Transactions',
      '', '', '', '', '', '',
      Number(unclearedNet),
      Number(running),
    ]);

    b.totalRow([
      `Register Balance as of ${report.statement_period_end}`,
      '', '', '',
      '', '', '', '', '',
      Number(registerNet),
      report.book_balance,
    ]);
    b.totalRow([
      'Ending Balance', '', '', '',
      '', '', '', '', '',
      Number(registerNet),
      report.book_balance,
    ], { grandTotal: true });
  }, detailWidths);

  await downloadWorkbook(wb, filename);
}

// ---------------------------------------------------------------------------
// Private: xlsx-based download helper (only for exportContacts)
// xlsx is lazy-loaded so the main report bundle does not pull it in.
// ---------------------------------------------------------------------------

let _xlsxModule: any = null;

async function _getXlsx(): Promise<any> {
  if (_xlsxModule) return _xlsxModule;
  _xlsxModule = await import('xlsx');
  return _xlsxModule;
}

async function downloadXlsx(
  rows: XlsxValue[][],
  filename: string,
  sheetName: string,
  cols: ColInfo[] | null = null,
) {
  const XLSX = await _getXlsx();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (cols) ws['!cols'] = cols;
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
