import { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  usePLReport, useBalanceSheetReport, useLedgerReport,
  useTrialBalanceReport, useDonorSummaryReport, useDonorDetailReport,
} from '../api/useReports';
import { useAccounts }  from '../api/useAccounts';
import { useFunds }     from '../api/useFunds';
import { useContacts }  from '../api/useContacts';
import Card    from '../components/ui/Card';
import Button  from '../components/ui/Button';
import Select  from '../components/ui/Select';
import Combobox from '../components/ui/Combobox';
import MultiSelectCombobox from '../components/ui/MultiSelectCombobox';
import DateRangePicker from '../components/ui/DateRangePicker';
import Badge   from '../components/ui/Badge';
import HardCloseWizard from './HardClose';
import {
  currentMonthRange,
  formatDateOnlyForDisplay,
  getChurchToday,
} from '../utils/date';
import type React from 'react';
import type {
  AccountType,
  BalanceSheetReportData,
  BalanceSheetReportFilters,
  DateRangeReportFilters,
  DonorDetailReportData,
  DonorDetailReportFilters,
  DonorSummaryReportData,
  DonorSummaryReportFilters,
  LedgerReportData,
  LedgerReportFilters,
  PLReportData,
  PLReportFilters,
  ReportDiagnostic,
  ReportInvestigateFilters,
  ReportType,
  TrialBalanceReportAccount,
  TrialBalanceReportData,
  TrialBalanceReportFilters,
} from '@shared/contracts';
import type { OptionValue, SelectOption } from '../components/ui/types';

const fmt  = (n: number | string | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
const fmtD = (d: string | null | undefined) => formatDateOnlyForDisplay(d);

function currentMonth() {
  return currentMonthRange();
}

const REPORT_TYPES: SelectOption<ReportType>[] = [
  { value: 'pl',             label: 'Profit & Loss' },
  { value: 'balance-sheet',  label: 'Balance Sheet' },
  { value: 'ledger',         label: 'General Ledger' },
  { value: 'trial-balance',  label: 'Trial Balance' },
  { value: 'donors-summary', label: 'Income by Donor — Summary' },
  { value: 'donors-detail',  label: 'Income by Donor — Detail' },
];

const SYNTHETIC_FUND_LABEL_PATTERN = /^\[System\] Net Income \(Prior Years\) - (.+)$/i
const TRIAL_BALANCE_TYPE_ORDER: Record<AccountType, number> = {
  ASSET: 1,
  LIABILITY: 2,
  EQUITY: 3,
  INCOME: 4,
  EXPENSE: 5,
}

type XlsxValue = string | number | boolean | null;
type XlsxRow = XlsxValue[];

function isNonZeroTrialBalanceAccount(account: TrialBalanceReportAccount) {
  return Number(account?.net_debit || 0) !== 0 || Number(account?.net_credit || 0) !== 0
}

function syntheticFundSortKey(account: TrialBalanceReportAccount) {
  const match = String(account?.name || '').match(SYNTHETIC_FUND_LABEL_PATTERN)
  if (match?.[1]) return match[1].trim().toLowerCase()
  return String(account?.name || '').trim().toLowerCase()
}

function sortTrialBalanceAccounts(accounts: TrialBalanceReportAccount[] = []) {
  return (accounts || [])
    .map((account, index) => ({ account, index }))
    .sort((a, b) => {
      const typeA = TRIAL_BALANCE_TYPE_ORDER[a.account.type]
      const typeB = TRIAL_BALANCE_TYPE_ORDER[b.account.type]
      if (typeA !== typeB) return typeA - typeB

      const byCode = String(a.account?.code || '').localeCompare(String(b.account?.code || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      })
      if (byCode !== 0) return byCode

      const syntheticA = Boolean(a.account?.is_synthetic)
      const syntheticB = Boolean(b.account?.is_synthetic)
      if (syntheticA !== syntheticB) return syntheticA ? 1 : -1

      if (syntheticA && syntheticB) {
        const byFund = syntheticFundSortKey(a.account).localeCompare(syntheticFundSortKey(b.account))
        if (byFund !== 0) return byFund
      }

      const byName = String(a.account?.name || '').localeCompare(String(b.account?.name || ''))
      if (byName !== 0) return byName
      return a.index - b.index
    })
    .map(({ account }) => account)
}

function getVisibleTrialBalanceAccounts(accounts: TrialBalanceReportAccount[] = [], { hideZeroBalances = false }: { hideZeroBalances?: boolean } = {}) {
  const ordered = sortTrialBalanceAccounts(accounts)
  if (!hideZeroBalances) return ordered

  const visibleSyntheticByCode = new Map()
  ordered.forEach((account) => {
    if (!account?.is_synthetic) return
    if (!isNonZeroTrialBalanceAccount(account)) return
    const code = String(account?.code || '')
    visibleSyntheticByCode.set(code, (visibleSyntheticByCode.get(code) || 0) + 1)
  })

  return ordered.filter((account) => {
    if (account?.is_synthetic) return isNonZeroTrialBalanceAccount(account)
    if (isNonZeroTrialBalanceAccount(account)) return true
    const code = String(account?.code || '')
    return (visibleSyntheticByCode.get(code) || 0) > 0
  })
}

// ── Excel Exporters ──────────────────────────────────────────────────────────
function exportPL(data: PLReportData, filters: PLReportFilters) {
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

function exportBalanceSheet(data: BalanceSheetReportData, filters: BalanceSheetReportFilters) {
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

function exportLedger(data: LedgerReportData, filters: LedgerReportFilters) {
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

function exportTrialBalance(data: TrialBalanceReportData, filters: TrialBalanceReportFilters) {
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

function exportDonorSummary(data: DonorSummaryReportData, filters: DonorSummaryReportFilters) {
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

function exportDonorDetail(data: DonorDetailReportData, filters: DonorDetailReportFilters) {
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

// ── Report renderers ─────────────────────────────────────────────────────────
interface ReportProps<TData> {
  data: TData;
}

interface InvestigableReportProps<TData> extends ReportProps<TData> {
  onInvestigate: (item: ReportDiagnostic | ReportInvestigateFilters) => void;
}

interface DiagnosticsPanelProps {
  diagnostics: ReportDiagnostic[];
  onInvestigate?: (item: ReportDiagnostic) => void;
}

interface DiagnosticGroupStyle {
  border: string;
  background: string;
  headingColor: string;
  textColor: string;
  title: string;
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

interface LineItemProps {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  valueColor?: string;
}

function PLReport({ data }: ReportProps<PLReportData>) {
  return (
    <div>
      <Section title="INCOME">
        {data.income.map((a) => <LineItem key={a.id} label={`${a.name}`} value={fmt(a.amount)} />)}
        <LineItem label="Total Income" value={fmt(data.total_income)} bold />
      </Section>
      <Section title="EXPENSES">
        {data.expenses.map((a) => <LineItem key={a.id} label={`${a.code} - ${a.name}`} value={fmt(a.amount)} />)}
        <LineItem label="Total Expenses" value={fmt(data.total_expenses)} bold />
      </Section>
      <div style={{ borderTop: '2px solid #1e293b', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
        <LineItem label="Net Surplus / (Deficit)" value={fmt(data.net_surplus)} bold
          valueColor={data.net_surplus >= 0 ? '#15803d' : '#dc2626'} />
      </div>
    </div>
  );
}

function DiagnosticsPanel({ diagnostics, onInvestigate }: DiagnosticsPanelProps) {
  const warnings = (diagnostics || []).filter((d) => d.severity === 'warning')
  const infos = (diagnostics || []).filter((d) => d.severity === 'info')

  const renderGroup = (items: ReportDiagnostic[], { border, background, headingColor, textColor, title }: DiagnosticGroupStyle) => {
    if (!items.length) return null
    return (
      <div style={{
        border: `1px solid ${border}`,
        background,
        borderRadius: '8px',
        padding: '0.75rem 0.9rem',
        marginBottom: '0.6rem',
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: headingColor, marginBottom: '0.4rem' }}>
          {title}
        </div>
        {items.map((item, idx) => (
          <div key={`${item.code}-${item.fund_id ?? 'none'}-${idx}`} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: '0.3rem 0',
          }}>
            <div style={{ fontSize: '0.82rem', color: textColor }}>{item.message}</div>
            {item.investigate_filters && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onInvestigate?.(item)}
              >
                Investigate
              </Button>
            )}
          </div>
        ))}
      </div>
    )
  }

  if (!warnings.length && !infos.length) return null

  return (
    <div style={{ marginBottom: '0.9rem' }}>
      {renderGroup(warnings, {
        border: '#fde68a',
        background: '#fffbeb',
        headingColor: '#92400e',
        textColor: '#78350f',
        title: 'Warnings',
      })}
      {renderGroup(infos, {
        border: '#bfdbfe',
        background: '#eff6ff',
        headingColor: '#1d4ed8',
        textColor: '#1e40af',
        title: 'Notes',
      })}
    </div>
  )
}

function BalanceSheetReport({ data, onInvestigate }: InvestigableReportProps<BalanceSheetReportData>) {
  return (
    <div>
      <DiagnosticsPanel diagnostics={data.diagnostics} onInvestigate={onInvestigate} />
      <Section title="ASSETS">
        {data.assets.map((a) => <LineItem key={a.id} label={`${a.code} - ${a.name}`} value={fmt(a.balance)} />)}
        <LineItem label="Total Assets" value={fmt(data.total_assets)} bold />
      </Section>
      <Section title="LIABILITIES">
        {data.liabilities.map((a) => <LineItem key={a.id} label={`${a.code} - ${a.name}`} value={fmt(a.balance)} />)}
        <LineItem label="Total Liabilities" value={fmt(data.total_liabilities)} bold />
      </Section>
      <Section title="EQUITY">
        {data.equity.map((a) => !a.is_synthetic ? (
          <LineItem key={a.id} label={`${a.code} - ${a.name}`} value={fmt(a.balance)} />
        ) : (
          <div key={a.id} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.35rem 0.5rem',
            marginBottom: '0.2rem',
            borderRadius: '6px',
            background: '#fff7ed',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingLeft: '1.5rem' }}>
              <span style={{ color: '#374151' }}>{`${a.code} - ${a.name}`}</span>
              <span style={{ fontSize: '0.7rem', color: '#9a3412' }}>
                Synthetic
              </span>
            </span>
            <span style={{ color: '#1e293b' }}>{fmt(a.balance)}</span>
          </div>
        ))}
        <LineItem label="Total Equity" value={fmt(data.total_equity)} bold />
      </Section>
      <div style={{ borderTop: '2px solid #1e293b', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
        <LineItem label="Total Liabilities + Equity" value={fmt(data.total_liabilities_and_equity)} bold />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <Badge label={data.is_balanced ? '✓ Balanced' : '✗ Not Balanced'}
            variant={data.is_balanced ? 'success' : 'error'} />
        </div>
      </div>
    </div>
  );
}

function LedgerReport({ data }: ReportProps<LedgerReportData>) {
  const headers = ['Date', 'Reference No', 'Description', 'Contact', 'Fund', 'Debit', 'Credit', 'Balance']
  const labelSpan = headers.length - 1
  const isLeftAlignedHeader = (header: string) => ['Date', 'Reference No', 'Description', 'Contact', 'Fund'].includes(header)

  return (
    <div>
      {(data.ledger || []).map((acct) => (
        <div key={acct.account.id} style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem',
            fontSize: '0.9rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.35rem' }}>
            {acct.account.code} — {acct.account.name}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#6b7280' }}>
                  {headers.map((h) => (
                    <th key={h} style={{ textAlign: isLeftAlignedHeader(h) ? 'left' : 'right',
                      padding: '0.3rem 0.5rem', fontWeight: 600, fontSize: '0.72rem',
                      textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr><td colSpan={labelSpan} style={{ padding: '0.3rem 0.5rem', color: '#6b7280' }}>Opening Balance</td>
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: 500 }}>{fmt(acct.opening_balance)}</td>
                </tr>
                {acct.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap' }}>{fmtD(r.date)}</td>
                    <td
                      title={r.reference_no || '-'}
                      style={{ padding: '0.3rem 0.5rem', width: '120px', minWidth: '120px', maxWidth: '120px',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {r.reference_no || '-'}
                    </td>
                    <td style={{ padding: '0.3rem 0.5rem' }}>{r.description}</td>
                    <td style={{ padding: '0.3rem 0.5rem', color: r.contact_name ? '#111827' : '#9ca3af' }}>
                      {r.contact_name || 'Unassigned'}
                    </td>
                    <td style={{ padding: '0.3rem 0.5rem', color: '#6b7280' }}>{r.fund_name}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#15803d' }}>
                      {r.debit > 0 ? fmt(r.debit) : ''}
                    </td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#b91c1c' }}>
                      {r.credit > 0 ? fmt(r.credit) : ''}
                    </td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: 500 }}>
                      {fmt(r.balance)}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td colSpan={labelSpan} style={{ padding: '0.3rem 0.5rem', fontWeight: 600 }}>Closing Balance</td>
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: 700 }}>{fmt(acct.closing_balance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function TrialBalanceReport({ data, onInvestigate }: InvestigableReportProps<TrialBalanceReportData>) {
  const orderedAccounts = getVisibleTrialBalanceAccounts(data.accounts || [])

  return (
    <div>
      <DiagnosticsPanel diagnostics={data.diagnostics} onInvestigate={onInvestigate} />

      <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
            {['Code','Account','Debit','Credit'].map((h) => (
              <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: h === 'Code' || h === 'Account' ? 'left' : 'right',
                fontWeight: 600, color: '#6b7280', fontSize: '0.775rem', textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orderedAccounts.map((a) => (
            <tr key={a.id} style={{
              borderBottom: '1px solid #f3f4f6',
              background: a.is_synthetic ? '#fff7ed' : 'transparent',
            }}>
              <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#6b7280' }}>{a.code}</td>
              <td style={{ padding: '0.55rem 0.75rem', paddingLeft: a.is_synthetic ? '1.5rem' : '0.75rem' }}>
                {a.name}
                {a.is_synthetic && (
                  <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: '#9a3412' }}>
                    Synthetic
                  </span>
                )}
              </td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', color: '#15803d' }}>{a.net_debit > 0 ? fmt(a.net_debit) : ''}</td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', color: '#b91c1c' }}>{a.net_credit > 0 ? fmt(a.net_credit) : ''}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid #1e293b', background: '#f8fafc' }}>
            <td colSpan={2} style={{ padding: '0.65rem 0.75rem', fontWeight: 700 }}>TOTALS</td>
            <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', fontWeight: 700 }}>{fmt(data.grand_total_debit)}</td>
            <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', fontWeight: 700 }}>{fmt(data.grand_total_credit)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
        <Badge label={data.is_balanced ? '✓ Balanced' : '✗ Not Balanced'}
          variant={data.is_balanced ? 'success' : 'error'} />
      </div>
    </div>
  );
}

function DonorSummaryReport({ data }: ReportProps<DonorSummaryReportData>) {
  const anonymous = data.anonymous

  return (
    <div>
      <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
            {['Donor','Donations','Total'].map((h) => (
              <th key={h} style={{ padding: '0.6rem 0.75rem',
                textAlign: h === 'Donations' || h === 'Total' ? 'right' : 'left',
                fontWeight: 600, color: '#6b7280', fontSize: '0.775rem', textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data.donors || []).map((d) => (
            <tr key={d.contact_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.55rem 0.75rem', fontWeight: 500 }}>{d.contact_name}</td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', color: '#6b7280' }}>{d.transaction_count}</td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', fontWeight: 600 }}>{fmt(d.total)}</td>
            </tr>
          ))}
          {anonymous && anonymous.total > 0 && (
            <tr style={{ borderBottom: '1px solid #f3f4f6', color: '#9ca3af' }}>
              <td style={{ padding: '0.55rem 0.75rem', fontStyle: 'italic' }}>Anonymous</td>
              <td /><td style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>{anonymous.transaction_count}</td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>{fmt(anonymous.total)}</td>
            </tr>
          )}
          <tr style={{ borderTop: '2px solid #1e293b', background: '#f8fafc' }}>
            <td colSpan={3} style={{ padding: '0.65rem 0.75rem', fontWeight: 700 }}>Grand Total</td>
            <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', fontWeight: 700 }}>{fmt(data.grand_total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DonorDetailReport({ data }: ReportProps<DonorDetailReportData>) {
  const anonymous = data.anonymous

  return (
    <div>
      {(data.donors || []).map((d) => (
        <div key={d.contact_id} style={{ marginBottom: '2rem', pageBreakInside: 'avoid' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>{d.contact_name}</div>
              {d.donor_id && (
                <div style={{ fontSize: '0.75rem', color: '#6b7280', fontFamily: 'monospace' }}>
                  ID: {d.donor_id}
                </div>
              )}
            </div>
          </div>
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Date','Description','Account','Fund','Amount'].map((h) => (
                  <th key={h} style={{ padding: '0.4rem 0.6rem', textAlign: h === 'Amount' ? 'right' : 'left',
                    fontWeight: 600, color: '#6b7280', fontSize: '0.72rem', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(d.transactions || []).map((tx, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{fmtD(tx.date)}</td>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{tx.description}</td>
                  <td style={{ padding: '0.35rem 0.6rem', color: '#6b7280' }}>{tx.account_name}</td>
                  <td style={{ padding: '0.35rem 0.6rem', color: '#6b7280' }}>{tx.fund_name}</td>
                  <td style={{ padding: '0.35rem 0.6rem', textAlign: 'right', fontWeight: 500 }}>{fmt(tx.amount)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                <td colSpan={4} style={{ padding: '0.35rem 0.6rem', fontWeight: 600 }}>Subtotal</td>
                <td style={{ padding: '0.35rem 0.6rem', textAlign: 'right', fontWeight: 700 }}>{fmt(d.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      {anonymous && anonymous.transactions.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, color: '#9ca3af', fontStyle: 'italic', marginBottom: '0.5rem' }}>
            Anonymous ({anonymous.transactions.length} donations)
          </div>
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Date','Description','Account','Fund','Amount'].map((h) => (
                  <th key={h} style={{ padding: '0.4rem 0.6rem', textAlign: h === 'Amount' ? 'right' : 'left',
                    fontWeight: 600, color: '#6b7280', fontSize: '0.72rem', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {anonymous.transactions.map((tx, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{fmtD(tx.date)}</td>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{tx.description}</td>
                  <td style={{ padding: '0.35rem 0.6rem', color: '#6b7280' }}>{tx.account_name}</td>
                  <td style={{ padding: '0.35rem 0.6rem', color: '#6b7280' }}>{tx.fund_name}</td>
                  <td style={{ padding: '0.35rem 0.6rem', textAlign: 'right', fontWeight: 500 }}>{fmt(tx.amount)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                <td colSpan={4} style={{ padding: '0.35rem 0.6rem', fontWeight: 600 }}>Subtotal</td>
                <td style={{ padding: '0.35rem 0.6rem', textAlign: 'right', fontWeight: 700 }}>{fmt(anonymous.total)}</td>
              </tr>
            </tbody>
          </table>
          <LineItem label="Total" value={fmt(anonymous.total)} bold />
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────
function Section({ title, children }: SectionProps) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ fontWeight: 700, fontSize: '0.75rem', color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        borderBottom: '1px solid #e5e7eb', paddingBottom: '0.35rem', marginBottom: '0.5rem' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function LineItem({ label, value, bold = false, valueColor }: LineItemProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between',
      padding: '0.3rem 0', fontSize: '0.875rem' }}>
      <span style={{ fontWeight: bold ? 600 : 400, color: '#374151' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: valueColor || '#1e293b' }}>{value}</span>
    </div>
  );
}

// ── Main Reports Page ────────────────────────────────────────────────────────
export default function Reports() {
  const [type,    setType]    = useState<ReportType>('pl');
  const [range,   setRange]   = useState(currentMonth());
  const [asOf,    setAsOf]    = useState(getChurchToday());
  const [fundId,  setFundId]  = useState('');
  const [acctId,  setAcctId]  = useState('');
  const [ctcId,   setCtcId]   = useState('');
  const [donorAcctIds, setDonorAcctIds] = useState<OptionValue[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [hardCloseOpen, setHardCloseOpen] = useState(false);

  const { data: funds    } = useFunds();
  const { data: accounts } = useAccounts();
  const { data: incomeAccounts } = useAccounts({ type: 'INCOME' });
  const { data: contacts } = useContacts({ type: 'DONOR' });

  const fundOptions    = [{ value: '', label: 'All Funds' }, ...(funds || []).map((f) => ({ value: f.id, label: f.name }))];
  const accountOptions = [{ value: '', label: 'All Accounts' }, ...(accounts || []).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))];
  const incomeAccountOptions = (incomeAccounts || []).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
  const contactOptions = [{ value: '', label: 'All Donors' }, ...(contacts || []).map((c) => ({ value: c.id, label: c.name }))];
  const sortedAcctIds = [...donorAcctIds].sort((a, b) => Number(a) - Number(b));
  const acctIdsParam = sortedAcctIds.length ? sortedAcctIds.join(',') : undefined;

  const plFilters: PLReportFilters = { from: range.from, to: range.to, fund_id: fundId || undefined };
  const bsFilters: BalanceSheetReportFilters = { as_of: asOf, fund_id: fundId || undefined };
  const ledgerFilters: LedgerReportFilters = { from: range.from, to: range.to, fund_id: fundId || undefined, account_id: acctId || undefined };
  const tbFilters: TrialBalanceReportFilters = { as_of: asOf, fund_id: fundId || undefined };
  const dsFilters: DonorSummaryReportFilters = { from: range.from, to: range.to, fund_id: fundId || undefined, account_ids: acctIdsParam };
  const ddFilters: DonorDetailReportFilters = {
    from: range.from,
    to: range.to,
    fund_id: fundId || undefined,
    contact_id: ctcId || undefined,
    account_ids: acctIdsParam,
  };

  const plData  = usePLReport(plFilters,     enabled && type === 'pl');
  const bsData  = useBalanceSheetReport(bsFilters, enabled && type === 'balance-sheet');
  const lgData  = useLedgerReport(ledgerFilters,   enabled && type === 'ledger');
  const tbData  = useTrialBalanceReport(tbFilters, enabled && type === 'trial-balance');
  const dsData  = useDonorSummaryReport(dsFilters, enabled && type === 'donors-summary');
  const ddData  = useDonorDetailReport(ddFilters,  enabled && type === 'donors-detail');

  const activeQuery = { pl: plData, 'balance-sheet': bsData, ledger: lgData,
    'trial-balance': tbData, 'donors-summary': dsData, 'donors-detail': ddData }[type];

  const isLoading  = activeQuery?.isFetching ?? false;
  const hasReportData = Boolean(activeQuery?.data?.data);

  function handleRun() { setEnabled(false); setTimeout(() => setEnabled(true), 0); }

  function handleExport() {
    if (type === 'pl' && plData.data) exportPL(plData.data.data, plFilters);
    if (type === 'balance-sheet' && bsData.data) exportBalanceSheet(bsData.data.data, bsFilters);
    if (type === 'ledger' && lgData.data) exportLedger(lgData.data.data, ledgerFilters);
    if (type === 'trial-balance' && tbData.data) exportTrialBalance(tbData.data.data, tbFilters);
    if (type === 'donors-summary' && dsData.data) exportDonorSummary(dsData.data.data, dsFilters);
    if (type === 'donors-detail' && ddData.data) exportDonorDetail(ddData.data.data, ddFilters);
  }

  function handleInvestigate(item: ReportDiagnostic | ReportInvestigateFilters) {
    if ('code' in item && item.code === 'SUGGEST_HARD_CLOSE') {
      setHardCloseOpen(true)
      return
    }
    const filters = 'investigate_filters' in item ? item.investigate_filters : item
    if (!filters) return
    setType('ledger')
    setRange({ from: filters.from, to: filters.to })
    setAcctId(filters.account_id ? String(filters.account_id) : '')
    if (filters.fund_id) setFundId(String(filters.fund_id))
    setEnabled(false)
    setTimeout(() => setEnabled(true), 0)
  }

  const needsAsOf = type === 'balance-sheet' || type === 'trial-balance';

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', marginBottom: '1.5rem' }}>
        Reports
      </h1>

      {/* Filter bar */}
      <Card style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1rem', alignItems: 'end' }}>
            <Select label="Report Type" value={type}
              onChange={(e) => {
                const nextType = e.target.value as ReportType
                setType(nextType)
                if (nextType !== 'donors-summary' && nextType !== 'donors-detail') setDonorAcctIds([])
                setEnabled(false)
              }}
              options={REPORT_TYPES} />
            {!needsAsOf && (
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500,
                  color: '#374151', marginBottom: '0.3rem' }}>Date Range</label>
                <DateRangePicker from={range.from} to={range.to}
                  onChange={(r) => { setRange(r); setEnabled(false); }} />
              </div>
            )}
            {needsAsOf && (
              <div style={{ maxWidth: '180px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500,
                  color: '#374151', marginBottom: '0.3rem' }}>As of Date</label>
                <input type="date" value={asOf}
                  onChange={(e) => { setAsOf(e.target.value); setEnabled(false); }}
                  style={{ padding: '0.45rem 0.75rem', border: '1px solid #d1d5db',
                    borderRadius: '6px', fontSize: '0.875rem' }} />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Select label="Fund" value={fundId}
              onChange={(e) => { setFundId(e.target.value); setEnabled(false); }}
              options={fundOptions} style={{ minWidth: '180px' }} />
            {(type === 'donors-summary' || type === 'donors-detail') && (
              <MultiSelectCombobox
                label="Income Accounts"
                options={incomeAccountOptions}
                value={donorAcctIds}
                onChange={(ids) => { setDonorAcctIds(ids); setEnabled(false); }}
                placeholder="All Accounts"
                style={{ minWidth: '240px' }}
              />
            )}
            {type === 'ledger' && (
              <Combobox label="Account" options={accountOptions} value={acctId}
                onChange={(v) => { setAcctId(String(v)); setEnabled(false); }}
                placeholder="All Accounts" style={{ minWidth: '240px' }} />
            )}
            {type === 'donors-detail' && (
              <Combobox label="Donor" options={contactOptions} value={ctcId}
                onChange={(v) => { setCtcId(String(v)); setEnabled(false); }}
                placeholder="All Donors" style={{ minWidth: '200px' }} />
            )}
            <Button onClick={handleRun} isLoading={isLoading} style={{ marginTop: 'auto' }}>
              Run Report
            </Button>
            {hasReportData && (
              <Button variant="secondary" onClick={handleExport} style={{ marginTop: 'auto' }}>
                Export Excel
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Report output */}
      {isLoading && (
        <Card><div style={{ padding: '2rem', color: '#6b7280', textAlign: 'center' }}>
          Generating report…
        </div></Card>
      )}

      {!isLoading && hasReportData && (
        <Card>
          <div style={{ marginBottom: '1rem', paddingBottom: '0.75rem',
            borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
              {REPORT_TYPES.find((r) => r.value === type)?.label}
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
              {needsAsOf ? `As of ${asOf}` : `${range.from} — ${range.to}`}
              {fundId && ` · ${(funds || []).find((f) => f.id === Number(fundId))?.name}`}
              {(type === 'donors-summary' || type === 'donors-detail') && donorAcctIds.length > 0 &&
                ` · ${donorAcctIds.length} account${donorAcctIds.length > 1 ? 's' : ''}`}
            </div>
          </div>

          {type === 'pl' && plData.data && <PLReport data={plData.data.data} />}
          {type === 'balance-sheet' && bsData.data && <BalanceSheetReport data={bsData.data.data} onInvestigate={handleInvestigate} />}
          {type === 'ledger' && lgData.data && <LedgerReport data={lgData.data.data} />}
          {type === 'trial-balance' && tbData.data && <TrialBalanceReport data={tbData.data.data} onInvestigate={handleInvestigate} />}
          {type === 'donors-summary' && dsData.data && <DonorSummaryReport data={dsData.data.data} />}
          {type === 'donors-detail' && ddData.data && <DonorDetailReport data={ddData.data.data} />}
        </Card>
      )}

      {!isLoading && !hasReportData && enabled && (
        <Card><div style={{ padding: '2rem', color: '#9ca3af', textAlign: 'center' }}>
          No data found for the selected filters.
        </div></Card>
      )}

      <HardCloseWizard
        open={hardCloseOpen}
        onClose={() => setHardCloseOpen(false)}
        onSuccess={() => activeQuery?.refetch?.()}
      />
    </div>
  );
}
