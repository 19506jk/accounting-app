import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type { BillAgingReportResponse, BillSummaryResponse } from '@shared/contracts';
import {
  getChurchToday,
  normalizeDateOnly,
  parseDateOnlyStrict,
} from '../../utils/date.js';
import { getChurchTimeZone } from '../churchTimeZone.js';

const db = require('../../db') as Knex;

type Numeric = string | number;

interface UnpaidSummaryRow {
  count: string | number;
  total_outstanding: Numeric | null;
  earliest_due: string | null;
}

interface AgingSourceBillRow {
  id: number;
  contact_id: number;
  vendor_name: string;
  bill_number: string | null;
  description: string;
  amount: Numeric;
  amount_paid: Numeric;
  due_date: string | Date | null;
}

type AgingBill = AgingSourceBillRow & {
  amount: number;
  amount_paid: number;
  due_date: string;
  outstanding: number;
  days_overdue: number;
};

type AgingBucket = {
  current: AgingBill[];
  days31_60: AgingBill[];
  days61_90: AgingBill[];
  days90_plus: AgingBill[];
};

type VendorAgingItem = {
  vendor_name: string;
  contact_id: number;
  current: number;
  days31_60: number;
  days61_90: number;
  days90_plus: number;
  total: number;
};

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);

function dayNumberFromDateOnly(dateOnly: string) {
  const [year, month, day] = dateOnly.split('-').map((n) => parseInt(n, 10));
  return Date.UTC(year || 0, (month || 1) - 1, day || 1);
}

export async function getAgingReport(
  asOfDate: string | Date = getChurchToday(getChurchTimeZone()),
  executor: Knex | Knex.Transaction = db
): Promise<BillAgingReportResponse['report']> {
  const asOfInput = typeof asOfDate === 'string' ? asOfDate : normalizeDateOnly(asOfDate);
  const asOf = parseDateOnlyStrict(asOfInput)
    ? asOfInput
    : getChurchToday(getChurchTimeZone());
  
  const bills = await executor('bills as b')
    .join('contacts as c', 'c.id', 'b.contact_id')
    .where('b.status', 'UNPAID')
    .select(
      'b.id',
      'b.contact_id',
      'c.name as vendor_name',
      'b.bill_number',
      'b.description',
      'b.amount',
      'b.amount_paid',
      'b.due_date',
    ) as AgingSourceBillRow[];

  const aging: AgingBucket = { current: [], days31_60: [], days61_90: [], days90_plus: [] };

  bills.forEach(bill => {
    const dueDate = normalizeDateOnly(bill.due_date) || asOf;
    const daysOverdue = Math.floor((dayNumberFromDateOnly(asOf) - dayNumberFromDateOnly(dueDate)) / (1000 * 60 * 60 * 24));
    const outstanding = parseFloat(dec(bill.amount).minus(dec(bill.amount_paid)).toFixed(2));
    if (outstanding <= 0) return;

    const billData: AgingBill = {
      ...bill,
      amount: parseFloat(String(bill.amount)),
      amount_paid: parseFloat(String(bill.amount_paid)),
      due_date: dueDate,
      outstanding,
      days_overdue: daysOverdue,
    };

    if (daysOverdue <= 30) {
      aging.current.push(billData);
    } else if (daysOverdue <= 60) {
      aging.days31_60.push(billData);
    } else if (daysOverdue <= 90) {
      aging.days61_90.push(billData);
    } else {
      aging.days90_plus.push(billData);
    }
  });

  const byVendor: Record<string, {
    contact_id: number;
    current: number;
    days31_60: number;
    days61_90: number;
    days90_plus: number;
    total: number;
  }> = {};
  Object.entries(aging).forEach(([bucket, bucketBills]) => {
    bucketBills.forEach(bill => {
      if (!byVendor[bill.vendor_name]) {
        byVendor[bill.vendor_name] = {
          contact_id: bill.contact_id,
          current: 0,
          days31_60: 0,
          days61_90: 0,
          days90_plus: 0,
          total: 0,
        };
      }
      const vendor = byVendor[bill.vendor_name]!;
      vendor[bucket as keyof Omit<typeof vendor, 'contact_id' | 'total'>] += bill.outstanding;
      vendor.total += bill.outstanding;
    });
  });

  const vendorAging: VendorAgingItem[] = Object.entries(byVendor).map(([name, data]) => ({
    vendor_name: name,
    contact_id: data.contact_id,
    current: parseFloat(data.current.toFixed(2)),
    days31_60: parseFloat(data.days31_60.toFixed(2)),
    days61_90: parseFloat(data.days61_90.toFixed(2)),
    days90_plus: parseFloat(data.days90_plus.toFixed(2)),
    total: parseFloat(data.total.toFixed(2)),
  }));

  const totals: BillAgingReportResponse['report']['totals'] = {
    current: parseFloat(aging.current.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    days31_60: parseFloat(aging.days31_60.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    days61_90: parseFloat(aging.days61_90.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    days90_plus: parseFloat(aging.days90_plus.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    total: 0,
  };
  totals.total = totals.current + totals.days31_60 + totals.days61_90 + totals.days90_plus;

  return {
    as_of_date: asOf,
    vendor_aging: vendorAging,
    totals,
    buckets: {
      current: aging.current,
      days31_60: aging.days31_60,
      days61_90: aging.days61_90,
      days90_plus: aging.days90_plus,
    },
  };
}

export async function getUnpaidSummary(executor: Knex | Knex.Transaction = db): Promise<BillSummaryResponse['summary']> {
  const summary = await executor('bills')
    .where('status', 'UNPAID')
    .select(
      executor.raw('SUM(CASE WHEN amount - amount_paid > 0 THEN 1 ELSE 0 END) as count'),
      executor.raw('SUM(CASE WHEN amount - amount_paid > 0 THEN amount - amount_paid ELSE 0 END) as total_outstanding'),
      executor.raw('MIN(CASE WHEN amount - amount_paid > 0 THEN due_date ELSE NULL END) as earliest_due'),
    )
    .first() as UnpaidSummaryRow | undefined;

  return {
    count: parseInt(String(summary?.count ?? 0), 10),
    total_outstanding: parseFloat(dec(summary?.total_outstanding ?? 0).toFixed(2)),
    earliest_due: summary?.earliest_due ?? null,
  };
}
