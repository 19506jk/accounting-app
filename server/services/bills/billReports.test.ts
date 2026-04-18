import dotenv from 'dotenv';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillAgingReportResponse, BillSummaryResponse } from '@shared/contracts';

process.env.NODE_ENV = 'development';

dotenv.config();

let getAgingReport: (
  asOfDate: string | Date,
  executor: any
) => Promise<BillAgingReportResponse['report']>;
let getUnpaidSummary: (executor: any) => Promise<BillSummaryResponse['summary']>;
const dbMock = vi.fn() as any;
dbMock.raw = vi.fn((sql: string) => ({ sql }));

beforeAll(async () => {
  const billReports = await import('./billReports.js');
  getAgingReport = billReports.getAgingReport;
  getUnpaidSummary = billReports.getUnpaidSummary;
});

function makeSelectQuery(rows: unknown[]) {
  const query: any = {
    join: vi.fn(() => query),
    where: vi.fn(() => query),
    select: vi.fn().mockResolvedValue(rows),
  };
  return query;
}

function makeFirstQuery(row: unknown) {
  const query: any = {
    where: vi.fn(() => query),
    select: vi.fn(() => query),
    first: vi.fn().mockResolvedValue(row),
  };
  return query;
}

beforeEach(() => {
  dbMock.mockReset();
  dbMock.raw.mockClear();
});

describe('getAgingReport', () => {
  it('buckets unpaid bills by age and aggregates vendor totals', async () => {
    const query = makeSelectQuery([
      {
        id: 1,
        contact_id: 10,
        vendor_name: 'Vendor A',
        bill_number: 'CUR-1',
        description: 'Current bill',
        amount: '100.00',
        amount_paid: '20.00',
        due_date: '2026-04-17',
      },
      {
        id: 2,
        contact_id: 10,
        vendor_name: 'Vendor A',
        bill_number: 'D31-1',
        description: '31 day bill',
        amount: '70.00',
        amount_paid: '0.00',
        due_date: '2026-03-01',
      },
      {
        id: 3,
        contact_id: 11,
        vendor_name: 'Vendor B',
        bill_number: 'D61-1',
        description: '61 day bill',
        amount: '90.00',
        amount_paid: '10.00',
        due_date: '2026-02-01',
      },
      {
        id: 4,
        contact_id: 12,
        vendor_name: 'Vendor C',
        bill_number: 'D90-1',
        description: '90 plus bill',
        amount: '40.00',
        amount_paid: '0.00',
        due_date: '2025-12-01',
      },
      {
        id: 5,
        contact_id: 13,
        vendor_name: 'Vendor D',
        bill_number: 'NODUE-1',
        description: 'No due date bill',
        amount: '5.00',
        amount_paid: '0.00',
        due_date: null,
      },
      {
        id: 6,
        contact_id: 14,
        vendor_name: 'Vendor E',
        bill_number: 'PAID-1',
        description: 'Fully paid bill',
        amount: '10.00',
        amount_paid: '10.00',
        due_date: '2026-01-01',
      },
    ]);
    dbMock.mockReturnValue(query);

    const report = await getAgingReport('2026-04-17', dbMock);

    expect(dbMock).toHaveBeenCalledWith('bills as b');
    expect(query.where).toHaveBeenCalledWith('b.status', 'UNPAID');
    expect(report.as_of_date).toBe('2026-04-17');
    expect(report.totals).toEqual({
      current: 85,
      days31_60: 70,
      days61_90: 80,
      days90_plus: 40,
      total: 275,
    });
    expect(report.vendor_aging).toEqual(expect.arrayContaining([
      {
        vendor_name: 'Vendor A',
        contact_id: 10,
        current: 80,
        days31_60: 70,
        days61_90: 0,
        days90_plus: 0,
        total: 150,
      },
      {
        vendor_name: 'Vendor D',
        contact_id: 13,
        current: 5,
        days31_60: 0,
        days61_90: 0,
        days90_plus: 0,
        total: 5,
      },
    ]));
    expect(report.buckets.current).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 1,
        due_date: '2026-04-17',
        outstanding: 80,
        days_overdue: 0,
      }),
      expect.objectContaining({
        id: 5,
        due_date: '2026-04-17',
        outstanding: 5,
        days_overdue: 0,
      }),
    ]));
    expect(report.buckets.days31_60).toEqual([
      expect.objectContaining({
        id: 2,
        due_date: '2026-03-01',
        outstanding: 70,
        days_overdue: 47,
      }),
    ]);
    expect(report.buckets.days61_90).toEqual([
      expect.objectContaining({
        id: 3,
        due_date: '2026-02-01',
        outstanding: 80,
        days_overdue: 75,
      }),
    ]);
    expect(report.buckets.days90_plus).toEqual([
      expect.objectContaining({
        id: 4,
        due_date: '2025-12-01',
        outstanding: 40,
        days_overdue: 137,
      }),
    ]);
  });

  it('falls back to the church date when as_of is invalid', async () => {
    const query = makeSelectQuery([]);
    dbMock.mockReturnValue(query);

    const report = await getAgingReport('not-a-date', dbMock);

    expect(report.as_of_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.totals).toEqual({
      current: 0,
      days31_60: 0,
      days61_90: 0,
      days90_plus: 0,
      total: 0,
    });
  });
});

describe('getUnpaidSummary', () => {
  it('formats unpaid summary aggregate values', async () => {
    const query = makeFirstQuery({
      count: '2',
      total_outstanding: '123.456',
      earliest_due: '2026-04-01',
    });
    dbMock.mockReturnValue(query);

    const summary = await getUnpaidSummary(dbMock);

    expect(dbMock).toHaveBeenCalledWith('bills');
    expect(query.where).toHaveBeenCalledWith('status', 'UNPAID');
    expect(dbMock.raw).toHaveBeenCalledTimes(3);
    expect(summary).toEqual({
      count: 2,
      total_outstanding: 123.46,
      earliest_due: '2026-04-01',
    });
  });

  it('returns zero summary values when the aggregate row is missing', async () => {
    const query = makeFirstQuery(undefined);
    dbMock.mockReturnValue(query);

    await expect(getUnpaidSummary(dbMock)).resolves.toEqual({
      count: 0,
      total_outstanding: 0,
      earliest_due: null,
    });
  });
});
