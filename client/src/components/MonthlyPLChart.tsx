import Card from './ui/Card';
import { formatMoney } from '../utils/format';
import type { MonthlyPLPoint } from '@shared/contracts';

// Matches the income/expense colors of the dashboard summary cards. The
// red/green pair fails the colorblind-separation check, so identity never
// relies on color alone: income is always the left bar and expenses the
// right bar within each month group, the legend is always present, and every
// bar carries a text title.
const INCOME_COLOR = '#15803d';
const EXPENSE_COLOR = '#b91c1c';

const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const WIDTH = 720;
const HEIGHT = 300;
const MARGIN = { top: 18, right: 8, bottom: 28, left: 56 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const BAR_GAP = 4;

function fmtTick(n: number): string {
  // Same sign-after-currency placement as formatMoney, compact for axes.
  const compact = new Intl.NumberFormat('en-CA', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
  return '$' + compact;
}

function niceStep(target: number): number {
  const raw = target / 4;
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * magnitude;
}

function monthLabel(monthStart: string): string {
  const month = Number(monthStart.slice(5, 7));
  return MONTH_ABBREVS[month - 1] ?? monthStart;
}

interface MonthlyPLChartProps {
  /** Monthly points, or null while the query has not resolved. */
  points: MonthlyPLPoint[] | null;
  /** Ending-year fiscal-year number, or null until settings load. */
  fiscalYear: number | null;
  isLoading: boolean;
  isError: boolean;
}

export default function MonthlyPLChart({ points, fiscalYear, isLoading, isError }: MonthlyPLChartProps) {
  // Errors win over the null states: when settings fail the parent still
  // passes fiscalYear === null (the range never computed) alongside isError,
  // and the error state must render instead of loading forever.
  const loading = isLoading || (!isError && (fiscalYear === null || points === null));
  const hasActivity = (points ?? []).some((p) => p.total_income !== 0 || p.total_expenses !== 0);

  if (loading) {
    return (
      <Card>
        <ChartHeader fiscalYear={fiscalYear} />
        <div
          role="status"
          aria-label="Loading income and expenses chart"
          style={{ height: '240px', borderRadius: '8px',
            background: 'linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%)',
            backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }}
        />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <ChartHeader fiscalYear={fiscalYear} />
        <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#6b7280', fontSize: '0.9rem' }}>
          Couldn&apos;t load monthly income and expenses.
        </div>
      </Card>
    );
  }

  if (!hasActivity) {
    return (
      <Card>
        <ChartHeader fiscalYear={fiscalYear} />
        <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#6b7280', fontSize: '0.9rem' }}>
          No income or expenses recorded yet{fiscalYear !== null ? ` for FY${fiscalYear}` : ''}.
        </div>
      </Card>
    );
  }

  const allValues = (points as MonthlyPLPoint[]).flatMap((p) => [p.total_income, p.total_expenses]);
  const rawMin = Math.min(0, ...allValues);
  const rawMax = Math.max(0, ...allValues);
  const span = Math.max(rawMax - rawMin, 1);
  const pad = span * 0.12;
  const bottom = rawMin - pad;
  const top = rawMax + pad;

  const step = niceStep(top - bottom);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  for (let v = -step; v >= bottom - 1e-9; v -= step) ticks.push(v);
  ticks.sort((a, b) => a - b);

  const scale = PLOT_H / (top - bottom);
  const yFor = (v: number) => MARGIN.top + (top - v) * scale;
  const baselineY = yFor(0);

  const pointsList = points as MonthlyPLPoint[];
  const groupW = PLOT_W / pointsList.length;
  const pairW = groupW * 0.62;
  const barW = Math.max((pairW - BAR_GAP) / 2, 2);

  const rangeDesc = pointsList.length > 0
    ? ` from ${pointsList[0]!.month_start} through ${pointsList[pointsList.length - 1]!.month_start}`
    : '';

  return (
    <Card>
      <ChartHeader fiscalYear={fiscalYear} />
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: '640px' }}>
          <svg
            role="img"
            aria-label={`Income and expenses by month${fiscalYear !== null ? `, FY${fiscalYear}` : ''}`}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            style={{ display: 'block', width: '100%', height: 'auto' }}
          >
            <title>Income and expenses by month{fiscalYear !== null ? `, FY${fiscalYear}` : ''}</title>
            <desc>
              Paired monthly totals: income in green and expenses in red, one pair per month{rangeDesc}.
            </desc>

            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + PLOT_W}
                  y1={yFor(tick)}
                  y2={yFor(tick)}
                  stroke={tick === 0 ? '#d1d5db' : '#eef2f7'}
                  strokeWidth={1}
                />
                <text
                  x={MARGIN.left - 6}
                  y={yFor(tick) + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="#6b7280"
                >
                  {fmtTick(tick)}
                </text>
              </g>
            ))}

            {pointsList.map((point, index) => {
              const groupX = MARGIN.left + index * groupW;
              const pairX = groupX + groupW / 2 - pairW / 2;
              const incomeX = pairX;
              const expenseX = pairX + barW + BAR_GAP;
              const label = monthLabel(point.month_start);
              const year = point.month_start.slice(0, 4);

              return (
                <g key={point.month_start}>
                  {point.total_income !== 0 && (
                    <rect
                      x={incomeX}
                      y={yFor(Math.max(0, point.total_income))}
                      width={barW}
                      height={Math.max(Math.abs(yFor(point.total_income) - baselineY), 2)}
                      rx={2}
                      fill={INCOME_COLOR}
                    >
                      <title>{`Income ${label} ${year}: ${formatMoney(point.total_income)}`}</title>
                    </rect>
                  )}
                  {point.total_expenses !== 0 && (
                    <rect
                      x={expenseX}
                      y={yFor(Math.max(0, point.total_expenses))}
                      width={barW}
                      height={Math.max(Math.abs(yFor(point.total_expenses) - baselineY), 2)}
                      rx={2}
                      fill={EXPENSE_COLOR}
                    >
                      <title>{`Expenses ${label} ${year}: ${formatMoney(point.total_expenses)}`}</title>
                    </rect>
                  )}
                  <text
                    x={groupX + groupW / 2}
                    y={HEIGHT - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#6b7280"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <style>{'@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}'}</style>
    </Card>
  );
}

function ChartHeader({ fiscalYear }: { fiscalYear: number | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
        Income and Expenses by Month
        {fiscalYear !== null && (
          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: 600,
            color: '#6b7280', background: '#f1f5f9', borderRadius: '999px',
            padding: '0.15rem 0.5rem' }}>
            FY{fiscalYear}
          </span>
        )}
      </h2>
      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: '#374151' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: INCOME_COLOR }} />
          Income
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: EXPENSE_COLOR }} />
          Expenses
        </span>
      </div>
    </div>
  );
}
