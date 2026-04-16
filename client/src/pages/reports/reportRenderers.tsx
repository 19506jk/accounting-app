import Badge from '../../components/ui/Badge';
import { formatDateOnlyForDisplay } from '../../utils/date';
import { DiagnosticsPanel, LineItem, Section } from './ReportSections';
import { getVisibleTrialBalanceAccounts } from './trialBalanceHelpers';
import type {
  BalanceSheetReportData,
  DonorDetailReportData,
  DonorSummaryReportData,
  LedgerReportData,
  PLReportData,
  ReportDiagnostic,
  ReportInvestigateFilters,
  TrialBalanceReportData,
} from '@shared/contracts';

const fmt  = (n: number | string | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
const fmtD = (d: string | null | undefined) => formatDateOnlyForDisplay(d);

interface ReportProps<TData> {
  data: TData;
}

interface InvestigableReportProps<TData> extends ReportProps<TData> {
  onInvestigate: (item: ReportDiagnostic | ReportInvestigateFilters) => void;
}

export function PLReport({ data }: ReportProps<PLReportData>) {
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

export function BalanceSheetReport({ data, onInvestigate }: InvestigableReportProps<BalanceSheetReportData>) {
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

export function LedgerReport({ data }: ReportProps<LedgerReportData>) {
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

export function TrialBalanceReport({ data, onInvestigate }: InvestigableReportProps<TrialBalanceReportData>) {
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

export function DonorSummaryReport({ data }: ReportProps<DonorSummaryReportData>) {
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

export function DonorDetailReport({ data }: ReportProps<DonorDetailReportData>) {
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
