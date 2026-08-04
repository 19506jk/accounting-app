import { useState } from 'react';
import { usePLSummary, useBalanceSheet, useRecentTransactions, useMonthlyPLSummary } from '../api/useDashboard';
import Card  from '../components/ui/Card';
import MonthlyPLChart from '../components/MonthlyPLChart';
import TransactionTable, { TYPE_BADGE, txFmt } from '../components/ui/TransactionTable';
import { useChurchDateConfig } from '../context/DateContext';
import { useSettings } from '../api/useSettings';
import { getFiscalYearFromDate, getFiscalYearRange } from '../utils/fiscalYear';
import { formatDateOnlyForDisplay, getChurchToday, lastMonthLabelInChurchZone } from '../utils/date';
import { formatMoney } from '../utils/format';
import type { TransactionListItem } from '@shared/contracts';
import type { TableColumn } from '../components/ui/types';

function lastMonthLabel() {
  return lastMonthLabelInChurchZone();
}

interface SummaryCardProps {
  label: string;
  value: string;
  isLoading: boolean;
  color?: string;
  sub?: string;
}

function SummaryCard({ label, value, isLoading, color, sub }: SummaryCardProps) {
  return (
    <Card>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
        {label}
      </div>
      {isLoading ? (
        <div style={{ height: '1.75rem', width: '60%', borderRadius: '4px',
          background: 'linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%)',
          backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
      ) : (
        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: color || '#1e293b', lineHeight: 1 }}>
          {value}
        </div>
      )}
      {sub && <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.4rem' }}>{sub}</div>}
    </Card>
  );
}

const TXN_COLUMNS: TableColumn<TransactionListItem>[] = [
  { key: 'date', label: 'Date',
    render: (r) => formatDateOnlyForDisplay(r.date) },
  { key: 'description', label: 'Description', wrap: true },
  { key: 'transaction_type', label: 'Type',
    render: (r) => {
      const badgeKey = r.transaction_type === 'deposit' && r.payment_method
        ? r.payment_method as keyof typeof TYPE_BADGE
        : r.transaction_type;
      const badge = TYPE_BADGE[badgeKey] ?? TYPE_BADGE.deposit;
      return (
        <span style={{ display: 'inline-block', padding: '0.15rem 0.5rem',
          borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
          background: badge.bg, color: badge.color, whiteSpace: 'nowrap' }}>
          {badge.label}
        </span>
      );
    },
  },
  { key: 'contact_name', label: 'Contact',
    render: (r) => r.contact_name || '—' },
  { key: 'reference_no', label: 'Ref',
    render: (r) => r.reference_no || <span style={{ color: '#d1d5db' }}>—</span> },
  { key: 'total_amount', label: 'Amount', align: 'right',
    render: (r) => txFmt(r.total_amount) },
];

export default function Dashboard() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const pl     = usePLSummary();
  const bs     = useBalanceSheet();
  const recent = useRecentTransactions(10);

  const { data: settings, isError: settingsError } = useSettings();
  const { churchTimeZone } = useChurchDateConfig();
  const fiscalStartMonth = Math.max(1, Math.min(12, parseInt(settings?.fiscal_year_start || '1', 10) || 1));
  // Stay at null until settings has loaded — avoids locking in the January
  // fallback on the first render and then missing the real start month when
  // it arrives (same pattern as Budget).
  const fiscal = settings !== undefined
    ? (() => {
        const fiscalYear = getFiscalYearFromDate(getChurchToday(churchTimeZone), fiscalStartMonth);
        const { from, to } = getFiscalYearRange(fiscalYear, fiscalStartMonth);
        return { fiscalYear, from, to };
      })()
    : null;
  const monthly = useMonthlyPLSummary(fiscal?.from ?? '', fiscal?.to ?? '', fiscal !== null);
  // A stale refetch can fail while React Query still holds the last good
  // data (settings or monthly points) — only treat a failure as fatal for
  // the chart when there is no data at all; otherwise it stays rendered.
  const chartError =
    (monthly.isError && monthly.data === undefined)
    || (settingsError && settings === undefined);

  const checkingBalance = bs.data?.assets?.find(
    (a) => a.name.toLowerCase().includes('checking')
  )?.balance ?? null;

  const surplusColor = typeof pl.data?.net_surplus === 'number' && pl.data.net_surplus >= 0 ? '#15803d' : '#b91c1c';

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', marginBottom: '1.5rem' }}>
        Dashboard
      </h1>

      <div style={{ display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem', marginBottom: '2rem' }}>
        <SummaryCard label="Total Income"    value={formatMoney(pl.data?.total_income)}
          isLoading={pl.isLoading} color="#15803d" sub={lastMonthLabel()} />
        <SummaryCard label="Total Expenses"  value={formatMoney(pl.data?.total_expenses)}
          isLoading={pl.isLoading} color="#b91c1c" sub={lastMonthLabel()} />
        <SummaryCard label="Net Surplus"     value={formatMoney(pl.data?.net_surplus)}
          isLoading={pl.isLoading} color={surplusColor} sub={lastMonthLabel()} />
        <SummaryCard label="Checking Balance" value={formatMoney(checkingBalance)}
          isLoading={bs.isLoading} color="#1d4ed8" sub="As of today" />
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <MonthlyPLChart
          points={monthly.data?.points ?? null}
          fiscalYear={fiscal?.fiscalYear ?? null}
          isLoading={monthly.isLoading}
          isError={chartError}
        />
      </div>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
            Recent Transactions
          </h2>
          <a href="/transactions" style={{ fontSize: '0.8rem', color: '#2563eb', textDecoration: 'none' }}>
            View all →
          </a>
        </div>
        <TransactionTable
          columns={TXN_COLUMNS}
          rows={recent.data || []}
          isLoading={recent.isLoading}
          emptyText="No transactions recorded yet."
          skeletonRows={5}
          expandedId={expanded}
          onExpandedChange={setExpanded}
        />
      </Card>

      <style>{'@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}'}</style>
    </div>
  );
}
