import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  usePLReport, useBalanceSheetReport, useLedgerReport,
  useTrialBalanceReport, useDonorSummaryReport, useDonorDetailReport,
} from '../api/useReports';
import { useAccounts }  from '../api/useAccounts';
import { useFunds }     from '../api/useFunds';
import { useContacts }  from '../api/useContacts';
import { useSettings }  from '../api/useSettings';
import Card    from '../components/ui/Card';
import Button  from '../components/ui/Button';
import Select  from '../components/ui/Select';
import Combobox from '../components/ui/Combobox';
import DateRangePicker from '../components/ui/DateRangePicker';
import Badge   from '../components/ui/Badge';
import {
  currentMonthRange,
  currentYearValue,
  formatDateOnlyForDisplay,
  getChurchToday,
} from '../utils/date';

// PDF receipt
import { PDFDownloadLink, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const fmt  = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
const fmtD = (d) => formatDateOnlyForDisplay(d);

function currentMonth() {
  return currentMonthRange();
}

const REPORT_TYPES = [
  { value: 'pl',             label: 'Statement of Activities (P&L)' },
  { value: 'balance-sheet',  label: 'Statement of Financial Position' },
  { value: 'ledger',         label: 'General Ledger' },
  { value: 'trial-balance',  label: 'Trial Balance' },
  { value: 'donors-summary', label: 'Income by Donor — Summary' },
  { value: 'donors-detail',  label: 'Income by Donor — Detail' },
];

// ── Excel Exporters ──────────────────────────────────────────────────────────
function exportPL(data, filters) {
  const rows = [
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

function exportBalanceSheet(data, filters) {
  const rows = [
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

function exportLedger(data, filters) {
  const rows = [
    ['General Ledger', '', '', '', '', ''],
    [`Period: ${filters.from} to ${filters.to}`, '', '', '', '', ''],
    [],
  ];
  (data.ledger || []).forEach((acct) => {
    rows.push([`${acct.account.code} — ${acct.account.name}`, '', '', '', '', '']);
    rows.push(['Date', 'Description', 'Fund', 'Debit', 'Credit', 'Balance']);
    rows.push(['Opening Balance', '', '', '', '', acct.opening_balance]);
    acct.rows.forEach((r) => rows.push([r.date, r.description, r.fund_name, r.debit || '', r.credit || '', r.balance]));
    rows.push(['Closing Balance', '', '', '', '', acct.closing_balance]);
    rows.push([]);
  });
  downloadXlsx(rows, `ledger_${filters.from}_${filters.to}.xlsx`, 'General Ledger');
}

function exportTrialBalance(data, filters) {
  const rows = [
    ['Trial Balance', '', '', ''],
    [`Period: ${filters.from} to ${filters.to}`, '', '', ''],
    [],
    ['Code', 'Account', 'Debit', 'Credit'],
    ...(data.accounts || []).map((a) => [a.code, a.name, a.total_debit, a.total_credit]),
    [],
    ['TOTALS', '', data.grand_total_debit, data.grand_total_credit],
    ['Balanced', '', '', data.is_balanced ? 'YES' : 'NO'],
  ];
  downloadXlsx(rows, `trial_balance_${filters.from}_${filters.to}.xlsx`, 'Trial Balance');
}

function exportDonorSummary(data, filters) {
  const rows = [
    ['Income by Donor — Summary', '', '', ''],
    [`Period: ${filters.from} to ${filters.to}`, '', '', ''],
    [],
    ['Donor', 'Type', 'Donations', 'Total'],
    ...(data.donors || []).map((d) => [d.contact_name, d.contact_type, d.transaction_count, d.total]),
    ['Anonymous', '', data.anonymous?.transaction_count || 0, data.anonymous?.total || 0],
    [],
    ['Grand Total', '', '', data.grand_total],
  ];
  downloadXlsx(rows, `donor_summary_${filters.from}_${filters.to}.xlsx`, 'Donor Summary');
}

function exportDonorDetail(data, filters) {
  const rows = [
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

function downloadXlsx(rows, filename, sheetName) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

// ── CRA Donation Receipt PDF ─────────────────────────────────────────────────
const receiptStyles = StyleSheet.create({
  page:     { padding: 48, fontFamily: 'Helvetica', fontSize: 10 },
  heading:  { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  subhead:  { fontSize: 11, marginBottom: 2 },
  section:  { marginTop: 16, marginBottom: 8 },
  row:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  label:    { color: '#666' },
  bold:     { fontWeight: 'bold' },
  divider:  { borderBottom: '1pt solid #ccc', marginVertical: 8 },
  tableRow: { flexDirection: 'row', borderBottom: '0.5pt solid #eee', paddingVertical: 3 },
  col1:     { width: '20%' },
  col2:     { width: '40%' },
  col3:     { width: '20%' },
  col4:     { width: '20%', textAlign: 'right' },
  sigLine:  { borderBottom: '1pt solid #000', width: 200, marginTop: 32, marginBottom: 4 },
  footer:   { fontSize: 8, color: '#999', marginTop: 16 },
});

function ReceiptPDF({ receipt }) {
  const { church, donor, year, donations, total, eligible_amount } = receipt;
  return (
    <Document>
      <Page size="A4" style={receiptStyles.page}>
        {/* Church header */}
        <Text style={receiptStyles.heading}>{church.name}</Text>
        <Text style={receiptStyles.subhead}>{church.address_line1}</Text>
        {church.address_line2 && <Text style={receiptStyles.subhead}>{church.address_line2}</Text>}
        <Text style={receiptStyles.subhead}>
          {church.city}{church.province ? `, ${church.province}` : ''}{church.postal_code ? `  ${church.postal_code}` : ''}
        </Text>
        {church.registration_no && (
          <Text style={receiptStyles.subhead}>CRA Registration: {church.registration_no}</Text>
        )}

        <View style={receiptStyles.divider} />

        <Text style={[receiptStyles.heading, { fontSize: 13 }]}>
          OFFICIAL DONATION RECEIPT — {year}
        </Text>

        {/* Donor */}
        <View style={receiptStyles.section}>
          <Text style={receiptStyles.label}>Issued to:</Text>
          <Text style={receiptStyles.bold}>{donor.name}</Text>
          {/* Donor ID — shown when available */}
          {donor.donor_id && (
            <Text style={{ fontSize: 9, color: '#555', marginTop: 2 }}>
              Donor ID: {donor.donor_id}
            </Text>
          )}
          {donor.address_line1 && <Text>{donor.address_line1}</Text>}
          {donor.address_line2 && <Text>{donor.address_line2}</Text>}
          <Text>
            {donor.city}{donor.province ? `, ${donor.province}` : ''}{donor.postal_code ? `  ${donor.postal_code}` : ''}
          </Text>
        </View>

        {/* Location of issue — CRA mandatory */}
        <Text style={{ marginBottom: 8 }}>
          <Text style={receiptStyles.label}>Issued at: </Text>
          {church.city || ''}{church.province ? `, ${church.province}` : ''}
        </Text>

        <View style={receiptStyles.divider} />

        {/* Donations table */}
        <View style={{ marginBottom: 8 }}>
          <View style={[receiptStyles.tableRow, { fontWeight: 'bold' }]}>
            <Text style={receiptStyles.col1}>Date</Text>
            <Text style={receiptStyles.col2}>Description</Text>
            <Text style={receiptStyles.col3}>Account</Text>
            <Text style={receiptStyles.col4}>Amount</Text>
          </View>
          {donations.map((d, i) => (
            <View key={i} style={receiptStyles.tableRow}>
              <Text style={receiptStyles.col1}>{fmtD(d.date)}</Text>
              <Text style={receiptStyles.col2}>{d.description}</Text>
              <Text style={receiptStyles.col3}>{d.account_name}</Text>
              <Text style={receiptStyles.col4}>{fmt(d.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={receiptStyles.divider} />

        {/* Totals — CRA mandatory wording */}
        <View style={receiptStyles.row}>
          <Text style={receiptStyles.label}>Total donations for {year}:</Text>
          <Text style={receiptStyles.bold}>{fmt(total)}</Text>
        </View>
        <View style={receiptStyles.row}>
          <Text style={receiptStyles.label}>Eligible amount for tax purposes:</Text>
          <Text style={receiptStyles.bold}>{fmt(eligible_amount)}</Text>
        </View>

        {/* Signature — CRA mandatory */}
        <View style={{ marginTop: 24 }}>
          <View style={receiptStyles.sigLine} />
          <Text style={receiptStyles.label}>Authorized Signature</Text>
        </View>

        <Text style={receiptStyles.footer}>
          Generated: {getChurchToday()} — This is an official receipt for income tax purposes.
        </Text>
      </Page>
    </Document>
  );
}

// ── Report renderers ─────────────────────────────────────────────────────────
function PLReport({ data }) {
  return (
    <div>
      <Section title="INCOME">
        {data.income.map((a) => <LineItem key={a.id} label={`${a.name}`} value={fmt(a.amount)} />)}
        <LineItem label="Total Income" value={fmt(data.total_income)} bold />
      </Section>
      <Section title="EXPENSES">
        {data.expenses.map((a) => <LineItem key={a.id} label={`${a.name}`} value={fmt(a.amount)} />)}
        <LineItem label="Total Expenses" value={fmt(data.total_expenses)} bold />
      </Section>
      <div style={{ borderTop: '2px solid #1e293b', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
        <LineItem label="Net Surplus / (Deficit)" value={fmt(data.net_surplus)} bold
          valueColor={data.net_surplus >= 0 ? '#15803d' : '#dc2626'} />
      </div>
    </div>
  );
}

function BalanceSheetReport({ data }) {
  return (
    <div>
      <Section title="ASSETS">
        {data.assets.map((a) => <LineItem key={a.id} label={a.name} value={fmt(a.balance)} />)}
        <LineItem label="Total Assets" value={fmt(data.total_assets)} bold />
      </Section>
      <Section title="LIABILITIES">
        {data.liabilities.map((a) => <LineItem key={a.id} label={a.name} value={fmt(a.balance)} />)}
        <LineItem label="Total Liabilities" value={fmt(data.total_liabilities)} bold />
      </Section>
      <Section title="EQUITY">
        {data.equity.map((a) => <LineItem key={a.id} label={a.name} value={fmt(a.balance)} />)}
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

function LedgerReport({ data }) {
  return (
    <div>
      {(data.ledger || []).map((acct) => (
        <div key={acct.account.id} style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem',
            fontSize: '0.9rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.35rem' }}>
            {acct.account.code} — {acct.account.name}
          </div>
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#6b7280' }}>
                {['Date','Description','Fund','Debit','Credit','Balance'].map((h) => (
                  <th key={h} style={{ textAlign: ['Date','Description','Fund'].includes(h) ? 'left' : 'right',
                    padding: '0.3rem 0.5rem', fontWeight: 600, fontSize: '0.72rem',
                    textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={5} style={{ padding: '0.3rem 0.5rem', color: '#6b7280' }}>Opening Balance</td>
                <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: 500 }}>{fmt(acct.opening_balance)}</td>
              </tr>
              {acct.rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap' }}>{fmtD(r.date)}</td>
                  <td style={{ padding: '0.3rem 0.5rem' }}>{r.description}</td>
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
                <td colSpan={5} style={{ padding: '0.3rem 0.5rem', fontWeight: 600 }}>Closing Balance</td>
                <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: 700 }}>{fmt(acct.closing_balance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function TrialBalanceReport({ data }) {
  return (
    <div>
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
          {(data.accounts || []).map((a) => (
            <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#6b7280' }}>{a.code}</td>
              <td style={{ padding: '0.55rem 0.75rem' }}>{a.name}</td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', color: '#15803d' }}>{a.total_debit > 0 ? fmt(a.total_debit) : ''}</td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', color: '#b91c1c' }}>{a.total_credit > 0 ? fmt(a.total_credit) : ''}</td>
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

function DonorSummaryReport({ data }) {
  return (
    <div>
      <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
            {['Donor','Type','Donations','Total'].map((h) => (
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
              <td style={{ padding: '0.55rem 0.75rem' }}><Badge label={d.contact_type?.toLowerCase()} variant={d.contact_type?.toLowerCase()} /></td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', color: '#6b7280' }}>{d.transaction_count}</td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', fontWeight: 600 }}>{fmt(d.total)}</td>
            </tr>
          ))}
          {data.anonymous?.total > 0 && (
            <tr style={{ borderBottom: '1px solid #f3f4f6', color: '#9ca3af' }}>
              <td style={{ padding: '0.55rem 0.75rem', fontStyle: 'italic' }}>Anonymous</td>
              <td /><td style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>{data.anonymous.transaction_count}</td>
              <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>{fmt(data.anonymous.total)}</td>
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

function DonorDetailReport({ data, settings }) {
  return (
    <div>
      {(data.donors || []).map((d) => (
        <div key={d.contact_id} style={{ marginBottom: '2rem', pageBreakInside: 'avoid' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '0.5rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>{d.contact_name}</div>
              {d.donor_id && (
                <div style={{ fontSize: '0.75rem', color: '#6b7280', fontFamily: 'monospace' }}>
                  ID: {d.donor_id}
                </div>
              )}
            </div>
            <PDFDownloadLink
              document={<ReceiptPDF receipt={{
                church: {
                  name:            settings?.church_name || '',
                  address_line1:   settings?.church_address_line1 || '',
                  city:            settings?.church_city || '',
                  province:        settings?.church_province || '',
                  postal_code:     settings?.church_postal_code || '',
                  registration_no: settings?.church_registration_no || '',
                },
                donor: d,   // d now includes donor_id from the API response
                year:         currentYearValue(),
                donations:    d.transactions || [],
                total:        d.total,
                eligible_amount: d.total,
              }} />}
              fileName={`receipt_${d.contact_name.replace(/\s+/g,'_')}.pdf`}
            >
              {({ loading }) => (
                <Button variant="secondary" size="sm" isLoading={loading}>
                  Download Receipt PDF
                </Button>
              )}
            </PDFDownloadLink>
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
      {data.anonymous?.transactions?.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, color: '#9ca3af', fontStyle: 'italic', marginBottom: '0.5rem' }}>
            Anonymous ({data.anonymous.transactions.length} donations)
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
              {data.anonymous.transactions.map((tx, i) => (
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
                <td style={{ padding: '0.35rem 0.6rem', textAlign: 'right', fontWeight: 700 }}>{fmt(data.anonymous.total)}</td>
              </tr>
            </tbody>
          </table>
          <LineItem label="Total" value={fmt(data.anonymous.total)} bold />
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────
function Section({ title, children }) {
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

function LineItem({ label, value, bold, valueColor }) {
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
  const [type,    setType]    = useState('pl');
  const [range,   setRange]   = useState(currentMonth());
  const [asOf,    setAsOf]    = useState(getChurchToday());
  const [fundId,  setFundId]  = useState('');
  const [acctId,  setAcctId]  = useState('');
  const [ctcId,   setCtcId]   = useState('');
  const [enabled, setEnabled] = useState(false);

  const { data: funds    } = useFunds();
  const { data: accounts } = useAccounts();
  const { data: contacts } = useContacts({ type: 'DONOR' });
  const { data: settings } = useSettings();

  const fundOptions    = [{ value: '', label: 'All Funds' }, ...(funds || []).map((f) => ({ value: f.id, label: f.name }))];
  const accountOptions = [{ value: '', label: 'All Accounts' }, ...(accounts || []).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))];
  const contactOptions = [{ value: '', label: 'All Donors' }, ...(contacts || []).map((c) => ({ value: c.id, label: c.name }))];

  const plFilters     = { from: range.from, to: range.to, fund_id: fundId || undefined };
  const bsFilters     = { as_of: asOf, fund_id: fundId || undefined };
  const ledgerFilters = { from: range.from, to: range.to, fund_id: fundId || undefined, account_id: acctId || undefined };
  const tbFilters     = { from: range.from, to: range.to, fund_id: fundId || undefined };
  const dsFilters     = { from: range.from, to: range.to, fund_id: fundId || undefined };
  const ddFilters     = { from: range.from, to: range.to, fund_id: fundId || undefined, contact_id: ctcId || undefined };

  const plData  = usePLReport(plFilters,     enabled && type === 'pl');
  const bsData  = useBalanceSheetReport(bsFilters, enabled && type === 'balance-sheet');
  const lgData  = useLedgerReport(ledgerFilters,   enabled && type === 'ledger');
  const tbData  = useTrialBalanceReport(tbFilters, enabled && type === 'trial-balance');
  const dsData  = useDonorSummaryReport(dsFilters, enabled && type === 'donors-summary');
  const ddData  = useDonorDetailReport(ddFilters,  enabled && type === 'donors-detail');

  const activeQuery = { pl: plData, 'balance-sheet': bsData, ledger: lgData,
    'trial-balance': tbData, 'donors-summary': dsData, 'donors-detail': ddData }[type];

  const reportData = activeQuery?.data?.data;
  const isLoading  = activeQuery?.isFetching;

  function handleRun() { setEnabled(false); setTimeout(() => setEnabled(true), 0); }

  function handleExport() {
    if (!reportData) return;
    const exportMap = {
      'pl':             () => exportPL(reportData, plFilters),
      'balance-sheet':  () => exportBalanceSheet(reportData, bsFilters),
      'ledger':         () => exportLedger(reportData, ledgerFilters),
      'trial-balance':  () => exportTrialBalance(reportData, tbFilters),
      'donors-summary': () => exportDonorSummary(reportData, dsFilters),
      'donors-detail':  () => exportDonorDetail(reportData, ddFilters),
    };
    exportMap[type]?.();
  }

  const needsAsOf = type === 'balance-sheet';

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
              onChange={(e) => { setType(e.target.value); setEnabled(false); }}
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
            {type === 'ledger' && (
              <Combobox label="Account" options={accountOptions} value={acctId}
                onChange={(v) => { setAcctId(v); setEnabled(false); }}
                placeholder="All Accounts" style={{ minWidth: '240px' }} />
            )}
            {type === 'donors-detail' && (
              <Combobox label="Donor" options={contactOptions} value={ctcId}
                onChange={(v) => { setCtcId(v); setEnabled(false); }}
                placeholder="All Donors" style={{ minWidth: '200px' }} />
            )}
            <Button onClick={handleRun} isLoading={isLoading} style={{ marginTop: 'auto' }}>
              Run Report
            </Button>
            {reportData && (
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

      {!isLoading && reportData && (
        <Card>
          <div style={{ marginBottom: '1rem', paddingBottom: '0.75rem',
            borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
              {REPORT_TYPES.find((r) => r.value === type)?.label}
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
              {needsAsOf ? `As of ${asOf}` : `${range.from} — ${range.to}`}
              {fundId && ` · ${(funds || []).find((f) => f.id === Number(fundId))?.name}`}
            </div>
          </div>

          {type === 'pl'             && <PLReport data={reportData} />}
          {type === 'balance-sheet'  && <BalanceSheetReport data={reportData} />}
          {type === 'ledger'         && <LedgerReport data={reportData} />}
          {type === 'trial-balance'  && <TrialBalanceReport data={reportData} />}
          {type === 'donors-summary' && <DonorSummaryReport data={reportData} />}
          {type === 'donors-detail'  && <DonorDetailReport data={reportData} settings={settings} />}
        </Card>
      )}

      {!isLoading && !reportData && enabled && (
        <Card><div style={{ padding: '2rem', color: '#9ca3af', textAlign: 'center' }}>
          No data found for the selected filters.
        </div></Card>
      )}
    </div>
  );
}
