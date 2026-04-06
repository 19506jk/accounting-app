import { usePLSummary, useBalanceSheet, useRecentTransactions } from '../api/useDashboard';
import Card  from '../components/ui/Card';
import Table from '../components/ui/Table';
import { formatDateOnlyForDisplay, monthLabelInChurchZone } from '../utils/date';

function fmt(n) {
  return typeof n === 'number'
    ? '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2 })
    : '—';
}

function currentMonthLabel() {
  return monthLabelInChurchZone();
}

function SummaryCard({ label, value, isLoading, color, sub }) {
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

const TXN_COLUMNS = [
  { key: 'date', label: 'Date',
    render: (r) => formatDateOnlyForDisplay(r.date) },
  { key: 'description', label: 'Description', wrap: true },
  { key: 'contact_name', label: 'Contact',
    render: (r) => r.contact_name || '—' },
  { key: 'total_amount', label: 'Amount', align: 'right',
    render: (r) => fmt(r.total_amount) },
];

export default function Dashboard() {
  const pl     = usePLSummary();
  const bs     = useBalanceSheet();
  const recent = useRecentTransactions(10);

  const checkingBalance = bs.data?.assets?.find(
    (a) => a.name.toLowerCase().includes('checking')
  )?.balance ?? null;

  const surplusColor = pl.data?.net_surplus >= 0 ? '#15803d' : '#b91c1c';

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', marginBottom: '1.5rem' }}>
        Dashboard
      </h1>

      <div style={{ display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem', marginBottom: '2rem' }}>
        <SummaryCard label="Total Income"    value={fmt(pl.data?.total_income)}
          isLoading={pl.isLoading} color="#15803d" sub={currentMonthLabel()} />
        <SummaryCard label="Total Expenses"  value={fmt(pl.data?.total_expenses)}
          isLoading={pl.isLoading} color="#b91c1c" sub={currentMonthLabel()} />
        <SummaryCard label="Net Surplus"     value={fmt(pl.data?.net_surplus)}
          isLoading={pl.isLoading} color={surplusColor} sub={currentMonthLabel()} />
        <SummaryCard label="Checking Balance" value={fmt(checkingBalance)}
          isLoading={bs.isLoading} color="#1d4ed8" sub="As of today" />
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
        <Table
          columns={TXN_COLUMNS}
          rows={recent.data || []}
          isLoading={recent.isLoading}
          emptyText="No transactions recorded yet."
          skeletonRows={5}
        />
      </Card>

      <style>{'@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}'}</style>
    </div>
  );
}
