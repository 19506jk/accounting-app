import { useQuery } from '@tanstack/react-query';
import client from './client';

// Helper — get YYYY-MM-DD string from a Date
function fmt(date) {
  return date.toISOString().split('T')[0];
}

// Current calendar month range
function currentMonth() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: fmt(start), to: fmt(now) };
}

/**
 * usePLSummary — income / expenses / surplus for the current month.
 * Independent query — has its own loading state.
 */
export function usePLSummary() {
  const { from, to } = currentMonth();
  return useQuery({
    queryKey: ['reports', 'pl', from, to],
    queryFn:  async () => {
      const { data } = await client.get(`/reports/pl?from=${from}&to=${to}`);
      return data.report.data;
    },
  });
}

/**
 * useBalanceSheet — asset balances as of today.
 * Independent query — has its own loading state.
 */
export function useBalanceSheet() {
  const today = fmt(new Date());
  return useQuery({
    queryKey: ['reports', 'balance-sheet', today],
    queryFn:  async () => {
      const { data } = await client.get(`/reports/balance-sheet?as_of=${today}`);
      return data.report.data;
    },
  });
}

/**
 * useRecentTransactions — last N transactions for the dashboard table.
 */
export function useRecentTransactions(limit = 10) {
  return useQuery({
    queryKey: ['transactions', 'recent', limit],
    queryFn:  async () => {
      const { data } = await client.get(`/transactions?limit=${limit}`);
      return data.transactions;
    },
  });
}
