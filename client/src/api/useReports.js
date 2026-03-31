import { useQuery } from '@tanstack/react-query';
import client from './client';

// staleTime: 0 — always refetch fresh on demand
// enabled — only fires when user clicks "Run Report"

export function usePLReport(filters, enabled) {
  return useQuery({
    queryKey:  ['report', 'pl', filters],
    queryFn:   async () => {
      const { data } = await client.get('/reports/pl', { params: filters });
      return data.report;
    },
    enabled:   !!enabled,
    staleTime: 0,
  });
}

export function useBalanceSheetReport(filters, enabled) {
  return useQuery({
    queryKey:  ['report', 'balance-sheet', filters],
    queryFn:   async () => {
      const { data } = await client.get('/reports/balance-sheet', { params: filters });
      return data.report;
    },
    enabled:   !!enabled,
    staleTime: 0,
  });
}

export function useLedgerReport(filters, enabled) {
  return useQuery({
    queryKey:  ['report', 'ledger', filters],
    queryFn:   async () => {
      const { data } = await client.get('/reports/ledger', { params: filters });
      return data.report;
    },
    enabled:   !!enabled,
    staleTime: 0,
  });
}

export function useTrialBalanceReport(filters, enabled) {
  return useQuery({
    queryKey:  ['report', 'trial-balance', filters],
    queryFn:   async () => {
      const { data } = await client.get('/reports/trial-balance', { params: filters });
      return data.report;
    },
    enabled:   !!enabled,
    staleTime: 0,
  });
}

export function useDonorSummaryReport(filters, enabled) {
  return useQuery({
    queryKey:  ['report', 'donors-summary', filters],
    queryFn:   async () => {
      const { data } = await client.get('/reports/donors/summary', { params: filters });
      return data.report;
    },
    enabled:   !!enabled,
    staleTime: 0,
  });
}

export function useDonorDetailReport(filters, enabled) {
  return useQuery({
    queryKey:  ['report', 'donors-detail', filters],
    queryFn:   async () => {
      const { data } = await client.get('/reports/donors/detail', { params: filters });
      return data.report;
    },
    enabled:   !!enabled,
    staleTime: 0,
  });
}
