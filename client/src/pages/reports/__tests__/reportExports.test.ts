import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

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
// Shared mock function & helpers
// ---------------------------------------------------------------------------

/** Mutated by each test to capture the workbook + filename. */
let capturedWorkbook: any = null;
let capturedFilename = '';

/** Round‑trip an ExcelJS workbook through xlsx so we can assert row values. */
async function sheetRows(
  wb: any,
  sheetName?: string,
): Promise<any[][]> {
  const buffer: ArrayBuffer = await wb.xlsx.writeBuffer();
  const rwb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const name = sheetName ?? rwb.SheetNames[0];
  if (!name) return [];
  const sheet = rwb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
  }) as any[][];
}

// ---------------------------------------------------------------------------
// Styled report export tests (ExcelJS path — real timers required)
// ---------------------------------------------------------------------------

describe('reportExports styled', () => {
  beforeEach(async () => {
    capturedWorkbook = null;
    capturedFilename = '';

    vi.resetModules();

    vi.doMock('../excelExportHelper', async () => {
      const actual =
        await vi.importActual<typeof import('../excelExportHelper')>(
          '../excelExportHelper',
        );
      return {
        ...actual,
        downloadWorkbook: vi.fn(async (wb: any, fn: string) => {
          capturedWorkbook = wb;
          capturedFilename = fn;
        }),
      };
    });
  });

  // ---- P&L -----------------------------------------------------------

  it('exports styled P&L workbook with headers and totals', async () => {
    const { exportPL } = await import('../reportExports');

    const data: PLReportData = {
      income: [{ id: 1, code: '4000', name: 'Donations', amount: 250 }],
      expenses: [{ id: 2, code: '5000', name: 'Rent', amount: 100 }],
      total_income: 250,
      total_expenses: 100,
      net_surplus: 150,
    };
    const filters: PLReportFilters = { from: '2026-01-01', to: '2026-03-31' };

    await exportPL(data, filters);

    expect(capturedFilename).toBe('pl_2026-01-01_2026-03-31.xlsx');
    expect(capturedWorkbook).toBeTruthy();

    const wb = capturedWorkbook;
    expect(wb.worksheets.map((s: any) => s.name)).toContain('Profit & Loss');

    // Row-content assertions (via xlsx round-trip)
    const rows = await sheetRows(wb, 'Profit & Loss');
    expect(rows).toContainEqual(['Profit & Loss', '', '']);
    expect(rows).toContainEqual(['', '4000 - Donations', 250]);
    expect(rows).toContainEqual(['', 'Total Income', 250]);
    expect(rows).toContainEqual(['', '5000 - Rent', 100]);
    expect(rows).toContainEqual(['', 'Total Expenses', 100]);
    expect(rows).toContainEqual(['Net Surplus / (Deficit)', '', 150]);

    // Style assertions
    const ws = wb.getWorksheet('Profit & Loss');

    const titleCell = ws.getCell(1, 1);
    expect(titleCell.font?.name).toBe('Arial');
    expect(titleCell.font?.size).toBe(14);
    expect(titleCell.font?.bold).toBe(true);

    const metaCell = ws.getCell(2, 1);
    expect(metaCell.font?.name).toBe('Arial');
    expect(metaCell.font?.size).toBe(10);
    expect(metaCell.font?.bold).toBeFalsy();

    const incomeHeader = ws.getCell(4, 1); // 'INCOME'
    expect(incomeHeader.font?.bold).toBe(true);
    expect(incomeHeader.fill?.type).toBe('pattern');

    const amountCell = ws.getCell(5, 3); // 250
    expect(amountCell.numFmt).toBe('#,##0.00;(#,##0.00)');
    expect(amountCell.alignment?.horizontal).toBe('right');
  }, 30_000);

  // ---- Balance Sheet -------------------------------------------------

  it('exports styled balance sheet workbook with balance status row', async () => {
    const { exportBalanceSheet } = await import('../reportExports');

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
    };
    const filters: BalanceSheetReportFilters = { as_of: '2026-03-31' };

    await exportBalanceSheet(data, filters);

    expect(capturedFilename).toBe('balance_sheet_2026-03-31.xlsx');

    const wb = capturedWorkbook;
    const rows = await sheetRows(wb, 'Balance Sheet');
    expect(rows).toContainEqual(['Balance Sheet', '', '']);
    expect(rows).toContainEqual(['', 'Total Assets', 100]);
    expect(rows).toContainEqual(['Balanced', '', 'YES']);

    // Total row ("Total Assets") has bold + top border
    const ws = wb.getWorksheet('Balance Sheet');
    const totalCell = ws.getCell(6, 2);
    expect(totalCell.font?.bold).toBe(true);
    expect(totalCell.border?.top?.style).toBe('thin');

    // Grand total ("Total Liabilities + Equity") has medium top border
    const grandCell = ws.getCell(16, 1);
    expect(grandCell.border?.top?.style).toBe('medium');
  }, 30_000);

  // ---- General Ledger ------------------------------------------------

  it('exports styled ledger workbook with opening and closing rows', async () => {
    const { exportLedger } = await import('../reportExports');

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
    };
    const filters: LedgerReportFilters = { from: '2026-03-01', to: '2026-03-31' };

    await exportLedger(data, filters);

    expect(capturedFilename).toBe('ledger_2026-03-01_2026-03-31.xlsx');

    const wb = capturedWorkbook;
    const rows = await sheetRows(wb, 'General Ledger');
    expect(rows).toContainEqual([
      'General Ledger', '', '', '', '', '', '', '',
    ]);
    expect(rows).toContainEqual([
      'Opening Balance', '', '', '', '', '', '', 50,
    ]);
    expect(rows).toContainEqual([
      '2026-03-02', '-', 'Deposit', 'Unassigned', 'General', 10, '', 60,
    ]);
    expect(rows).toContainEqual([
      'Closing Balance', '', '', '', '', '', '', 60,
    ]);

    // Column headers have bold + fill + bottom border
    const ws = wb.getWorksheet('General Ledger');
    const hdrCell = ws.getCell(5, 1);
    expect(hdrCell.font?.bold).toBe(true);
    expect(hdrCell.fill?.type).toBe('pattern');
    expect(hdrCell.border?.bottom?.style).toBe('thin');

    // Frozen panes: below title + metadata + blank = row 3
    expect(ws.views?.[0]?.state).toBe('frozen');
    expect(ws.views?.[0]?.ySplit).toBe(3);

    // Column widths
    expect(ws.getColumn(1).width).toBe(12);
    expect(ws.getColumn(3).width).toBe(28);
  }, 30_000);

  // ---- Trial Balance -------------------------------------------------

  it('exports styled trial balance with synthetic indentation', async () => {
    const { exportTrialBalance } = await import('../reportExports');

    const data: TrialBalanceReportData = {
      accounts: [
        {
          id: 1, code: '1000', name: 'Cash', type: 'ASSET',
          account_class: 'ASSET', normal_balance: 'DEBIT',
          net_side: 'DEBIT', net_debit: 100, net_credit: 0,
          total_debit: 100, total_credit: 0,
          is_abnormal_balance: false, is_synthetic: false,
          synthetic_note: null, investigate_filters: null,
        },
        {
          id: 2, code: '3000',
          name: '[System] Net Income (Prior Years) - General',
          type: 'EQUITY', account_class: 'EQUITY',
          normal_balance: 'CREDIT', net_side: 'CREDIT',
          net_debit: 0, net_credit: 10,
          total_debit: 0, total_credit: 10,
          is_abnormal_balance: false, is_synthetic: true,
          synthetic_note: null, investigate_filters: null,
        },
      ],
      grand_total_debit: 100, grand_total_credit: 10,
      is_balanced: false, as_of: '2026-03-31',
      fiscal_year_start: '2026-01-01',
      diagnostics: [], last_hard_close_date: null,
    };
    const filters: TrialBalanceReportFilters = { as_of: '2026-03-31' };

    await exportTrialBalance(data, filters);

    expect(capturedFilename).toBe('trial_balance_2026-03-31.xlsx');

    const wb = capturedWorkbook;
    const rows = await sheetRows(wb, 'Trial Balance');
    expect(rows).toContainEqual(['Trial Balance', '', '', '']);
    expect(rows).toContainEqual(['Code', 'Account', 'Debit', 'Credit']);
    expect(rows).toContainEqual([
      '3000',
      '[System] Net Income (Prior Years) - General [Synthetic]',
      0, 10,
    ]);
    expect(rows).toContainEqual(['TOTALS', '', 100, 10]);

    // Synthetic account indent
    const ws = wb.getWorksheet('Trial Balance');
    const synthCell = ws.getCell(6, 2);
    expect(synthCell.alignment?.indent).toBe(2);

    // TOTALS row is bold with top border
    const totalsCell = ws.getCell(8, 1);
    expect(totalsCell.font?.bold).toBe(true);
    expect(totalsCell.border?.top?.style).toBe('thin');
  }, 30_000);

  // ---- Donor Summary & Detail ----------------------------------------

  it('exports styled donor summary and donor detail with totals', async () => {
    const { exportDonorDetail, exportDonorSummary } =
      await import('../reportExports');

    // -- Summary --
    const summaryData: DonorSummaryReportData = {
      donors: [{
        contact_id: 1, contact_name: 'Jane Doe',
        contact_class: 'INDIVIDUAL', total: 200, transaction_count: 2,
      }],
      anonymous: { total: 50, transaction_count: 1 },
      grand_total: 250, donor_count: 1,
    };
    const summaryFilters: DonorSummaryReportFilters = {
      from: '2026-01-01', to: '2026-03-31',
    };

    await exportDonorSummary(summaryData, summaryFilters);
    expect(capturedFilename).toBe('donor_summary_2026-01-01_2026-03-31.xlsx');

    let wb = capturedWorkbook;
    let rows = await sheetRows(wb, 'Donor Summary');
    expect(rows).toContainEqual(['Income by Donor — Summary', '', '', '']);
    expect(rows).toContainEqual(['Grand Total', '', '', 250]);

    // Grand total has medium top border
    const summaryWs = wb.getWorksheet('Donor Summary');
    const grandCell = summaryWs.getCell(8, 1);
    expect(grandCell.border?.top?.style).toBe('medium');

    // -- Detail --
    capturedWorkbook = null;
    capturedFilename = '';

    const detailData: DonorDetailReportData = {
      donors: [{
        contact_id: 1, contact_name: 'Jane Doe',
        contact_class: 'INDIVIDUAL', donor_id: null, total: 200,
        transactions: [{
          transaction_id: 9, date: '2026-03-03',
          description: 'Donation', reference_no: null,
          account_code: '4000', account_name: 'Donations',
          fund_name: 'General', amount: 200, memo: null,
        }],
      }],
      anonymous: {
        total: 50,
        transactions: [{
          transaction_id: 10, date: '2026-03-05',
          description: 'Anonymous gift', reference_no: null,
          account_code: '4000', account_name: 'Donations',
          fund_name: 'General', amount: 50, memo: null,
        }],
      },
      grand_total: 250,
    };
    const detailFilters: DonorDetailReportFilters = {
      from: '2026-01-01', to: '2026-03-31',
    };

    await exportDonorDetail(detailData, detailFilters);
    expect(capturedFilename).toBe('donor_detail_2026-01-01_2026-03-31.xlsx');

    wb = capturedWorkbook;
    rows = await sheetRows(wb, 'Donor Detail');
    expect(rows).toContainEqual(['Income by Donor — Detail', '', '', '', '']);
    expect(rows).toContainEqual(['Grand Total', '', '', '', 250]);

    // Donor name band is a section header
    const detailWs = wb.getWorksheet('Donor Detail');
    const donorHeader = detailWs.getCell(4, 1);
    expect(donorHeader.font?.bold).toBe(true);
    expect(donorHeader.fill?.type).toBe('pattern');
  }, 30_000);

  // ---- Reconciliation ------------------------------------------------

  it('exports styled reconciliation with summary + detail sheets', async () => {
    const { exportReconciliationReport } =
      await import('../reportExports');

    const report: ReconciliationReport = {
      account_name: 'Checking', account_code: '1000',
      account_type: 'ASSET', is_closed: false, status: 'BALANCED',
      statement_period_start: '2026-03-01',
      statement_period_end: '2026-03-31',
      reconciliation_date: '2026-04-01T14:30:00.000Z',
      reconciler_name: 'Admin',
      opening_balance: 1000, cleared_in: 200, cleared_out: 150,
      statement_ending_balance: 1050, in_transit: 100,
      outstanding_out: 50, adjusted_bank_balance: 1100,
      book_balance: 1100, difference: 0,
      cleared_in_items: [{
        date: '2026-03-05', reference_no: null, payee: 'Donor',
        description: 'Deposit', memo: null, amount: 200,
        fund_name: 'General',
      }],
      cleared_out_items: [{
        date: '2026-03-06', reference_no: 'CHK100', payee: 'Vendor',
        description: 'Expense', memo: null, amount: 150,
        fund_name: 'General',
      }],
      in_transit_items: [], outstanding_out_items: [],
      fund_activity: [],
    };

    await exportReconciliationReport(report);

    expect(capturedFilename).toBe(
      'reconciliation_report_1000_2026-03-31.xlsx',
    );

    const wb = capturedWorkbook;
    expect(wb.worksheets.map((s: any) => s.name)).toEqual([
      'Summary', 'Detail',
    ]);

    const summaryRows = await sheetRows(wb, 'Summary');
    const detailRows = await sheetRows(wb, 'Detail');

    expect(summaryRows[0]?.[0]).toBe('1000 — Checking');
    expect(summaryRows.flat()).toContain('Reconciliation Summary');
    expect(summaryRows.flat()).toContain('Cleared Balance');
    expect(detailRows[0]?.[0]).toBe('1000 — Checking');
    expect(detailRows.flat()).toContain('Reconciliation Detail');
    expect(detailRows.flat()).toContain('Beginning Balance');

    // Title font on both sheets
    const sTitle = wb.getWorksheet('Summary').getCell(1, 1);
    expect(sTitle.font?.name).toBe('Arial');
    expect(sTitle.font?.size).toBe(14);

    const dTitle = wb.getWorksheet('Detail').getCell(1, 1);
    expect(dTitle.font?.name).toBe('Arial');
  }, 30_000);

  it('exports liability reconciliation with charge labels', async () => {
    const { exportReconciliationReport } =
      await import('../reportExports');

    const report: ReconciliationReport = {
      account_name: 'Credit Card', account_code: '2200',
      account_type: 'LIABILITY', is_closed: false, status: 'BALANCED',
      statement_period_start: '2026-03-01',
      statement_period_end: '2026/03/31',
      reconciliation_date: 'not-a-date', reconciler_name: 'Admin',
      opening_balance: 300, cleared_in: 25, cleared_out: 80,
      statement_ending_balance: 245, in_transit: 10,
      outstanding_out: 5, adjusted_bank_balance: 250,
      book_balance: 250, difference: 0,
      cleared_in_items: [],
      cleared_out_items: [{
        date: '2026-03-12', reference_no: '', payee: '',
        description: 'Card charge', memo: null, amount: 80,
        fund_name: 'General',
      }],
      in_transit_items: [], outstanding_out_items: [],
      fund_activity: [],
    };

    await exportReconciliationReport(report);

    expect(capturedFilename).toBe(
      'reconciliation_report_2200_2026/03/31.xlsx',
    );

    const wb = capturedWorkbook;
    const summaryRows = await sheetRows(wb, 'Summary');
    const detailRows = await sheetRows(wb, 'Detail');

    // Summary header rows: title merged, subtitle line without valid time
    expect(summaryRows[0]?.[0]).toBe('2200 — Credit Card');
    expect(summaryRows[1]?.[0]).toBe('Reconciliation Summary');
    expect(summaryRows.flat()).toContain('Charges - 1 items');
    expect(summaryRows.flat()).toContain('Receipts - 0 items');
    expect(detailRows.flat()).toContain('Charge');
    expect(detailRows).toContainEqual([
      '', '', '', '', 'Charge', '2026-03-12', '-', '', 'x', -80, 220,
    ]);
  }, 30_000);

  it('exports reconciliation detail rows for outstanding/in-transit items', async () => {
    const { exportReconciliationReport } =
      await import('../reportExports');

    const report: ReconciliationReport = {
      account_name: 'Checking', account_code: '1000',
      account_type: 'ASSET', is_closed: false, status: 'BALANCED',
      statement_period_start: '2026-03-01',
      statement_period_end: '2026-03-31',
      reconciliation_date: '2026-04-01T14:30:00.000Z',
      reconciler_name: 'Admin',
      opening_balance: 1000, cleared_in: 0, cleared_out: 0,
      statement_ending_balance: 1000, in_transit: 40,
      outstanding_out: 25, adjusted_bank_balance: 1015,
      book_balance: 1015, difference: 0,
      cleared_in_items: [], cleared_out_items: [],
      in_transit_items: [{
        date: '2026-03-20', reference_no: 'DEP-1', payee: 'Donor',
        description: 'Deposit in transit', memo: null, amount: 40,
        fund_name: 'General',
      }],
      outstanding_out_items: [{
        date: '2026-03-18', reference_no: 'CHK-2', payee: 'Vendor',
        description: 'Outstanding cheque', memo: null, amount: 25,
        fund_name: 'General',
      }],
      fund_activity: [],
    };

    await exportReconciliationReport(report);

    const wb = capturedWorkbook;
    const detailRows = await sheetRows(wb, 'Detail');

    expect(detailRows).toContainEqual([
      '', '', '', '', 'Cheque', '2026-03-18', 'CHK-2', 'Vendor', '', -25, 975,
    ]);
    expect(detailRows).toContainEqual([
      '', '', '', '', 'Deposit', '2026-03-20', 'DEP-1', 'Donor', '', 40, 1015,
    ]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Contacts export (unchanged — still on xlsx writeFile path)
// ---------------------------------------------------------------------------

describe('reportExports contacts', () => {
  it('exports active contacts with dated filename', async () => {
    vi.resetModules();

    // Browser‑mode vitest cannot spy on or mock ESM namespace exports
    // like xlsx.writeFile.  Instead we verify the workbook content by
    // intercepting the Blob constructor (which writeFile uses internally).
    const blobParts: any[] = [];
    const origBlob = globalThis.Blob;
    globalThis.Blob = class extends origBlob {
      constructor(parts: any[], opts: any) {
        blobParts.push(...parts);
        super(parts, opts);
      }
    } as any;

    try {
      // We need the real excelExportHelper, so mock it minimally
      // (contacts export doesn't use any ExcelJS functions).
      vi.doMock('../excelExportHelper', async () => {
        const actual =
          await vi.importActual<typeof import('../excelExportHelper')>(
            '../excelExportHelper',
          );
        return {
          ...actual,
          downloadWorkbook: vi.fn(async (_wb: any, _fn: string) => {}),
        };
      });

      const { exportContacts } = await import('../reportExports');

      const contacts: ContactSummary[] = [
        {
          id: 1, type: 'DONOR', contact_class: 'INDIVIDUAL',
          name: 'Jane Doe', first_name: 'Jane', last_name: 'Doe',
          email: 'jane@example.com', phone: null,
          address_line1: null, address_line2: null,
          city: null, province: null, postal_code: null,
          donor_id: 'D-100', is_active: true,
        },
        {
          id: 2, type: 'DONOR', contact_class: 'HOUSEHOLD',
          name: 'Inactive Household', first_name: null,
          last_name: null, email: null, phone: null,
          address_line1: null, address_line2: null,
          city: null, province: null, postal_code: null,
          donor_id: null, is_active: false,
        },
      ];

      await exportContacts(contacts);

      expect(blobParts.length).toBeGreaterThan(0);
      // The xlsx library writes the workbook buffer into a Blob.
      // In jsdom the buffer arrives as a Uint8Array inside an Array.
      const raw = blobParts[0];
      const u8: Uint8Array =
        raw instanceof Uint8Array
          ? raw
          : Array.isArray(raw)
            ? new Uint8Array(raw)
            : new Uint8Array(raw);
      const rwb = XLSX.read(u8, { type: 'array' });
      const sheetName = rwb.SheetNames[0] || 'Contacts';
      const sheet = rwb.Sheets[sheetName];
      if (!sheet) throw new Error('Contacts sheet not found');
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
      }) as any[][];

      // Verify the workbook has contact data (not empty, contains expected names)
      expect(rows.length).toBeGreaterThan(0);
      const allValues = rows.flat();
      expect(allValues).toContain('Jane Doe');
      expect(allValues).toContain('D-100');
      expect(allValues.includes('Inactive Household')).toBe(false);
    } finally {
      globalThis.Blob = origBlob;
    }
  });
});

// ---------------------------------------------------------------------------
// reportMetadata (unchanged)
// ---------------------------------------------------------------------------

describe('reportMetadata', () => {
  it('has canonical UI titles for all six report types', async () => {
    const { REPORT_META, getReportMeta, getReportTypeOptions } =
      await import('../reportMetadata');

    expect(REPORT_META['pl'].title).toBe('Profit & Loss');
    expect(REPORT_META['pl'].tabName).toBe('Profit & Loss');
    expect(REPORT_META['pl'].filenamePrefix).toBe('pl');

    expect(REPORT_META['balance-sheet'].title).toBe('Balance Sheet');
    expect(REPORT_META['balance-sheet'].tabName).toBe('Balance Sheet');
    expect(REPORT_META['balance-sheet'].filenamePrefix).toBe('balance_sheet');

    expect(REPORT_META['ledger'].title).toBe('General Ledger');
    expect(REPORT_META['ledger'].tabName).toBe('General Ledger');
    expect(REPORT_META['ledger'].filenamePrefix).toBe('ledger');

    expect(REPORT_META['trial-balance'].title).toBe('Trial Balance');
    expect(REPORT_META['trial-balance'].tabName).toBe('Trial Balance');
    expect(REPORT_META['trial-balance'].filenamePrefix).toBe('trial_balance');

    expect(REPORT_META['donors-summary'].title).toBe(
      'Income by Donor — Summary',
    );
    expect(REPORT_META['donors-summary'].tabName).toBe('Donor Summary');
    expect(REPORT_META['donors-summary'].filenamePrefix).toBe(
      'donor_summary',
    );

    expect(REPORT_META['donors-detail'].title).toBe(
      'Income by Donor — Detail',
    );
    expect(REPORT_META['donors-detail'].tabName).toBe('Donor Detail');
    expect(REPORT_META['donors-detail'].filenamePrefix).toBe('donor_detail');

    expect(getReportMeta('pl').title).toBe('Profit & Loss');

    const options = getReportTypeOptions();
    expect(options).toHaveLength(6);
    expect(options.find((o) => o.value === 'pl')?.label).toBe(
      'Profit & Loss',
    );
    expect(
      options.find((o) => o.value === 'balance-sheet')?.label,
    ).toBe('Balance Sheet');
  });
});
