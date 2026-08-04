import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  BalanceSheetReportFilters,
  BalanceSheetReportResponse,
  DonorDetailReportFilters,
  DonorDetailReportResponse,
  DonorSummaryReportFilters,
  DonorSummaryReportResponse,
  LedgerReportFilters,
  LedgerReportResponse,
  PLReportFilters,
  PLReportResponse,
  TrialBalanceReportFilters,
  TrialBalanceReportResponse,
} from '@shared/contracts'

export function plReportQueryOptions(filters: PLReportFilters) {
  return {
    queryKey: ['reports', 'pl', filters.from, filters.to, filters.fund_id ?? null] as const,
    queryFn: async () => {
      const { data } = await client.get<PLReportResponse>('/reports/pl', { params: filters })
      return data.report
    },
    staleTime: 0,
  }
}

export function balanceSheetReportQueryOptions(filters: BalanceSheetReportFilters) {
  return {
    queryKey: ['reports', 'balance-sheet', filters.as_of, filters.fund_id ?? null] as const,
    queryFn: async () => {
      const { data } = await client.get<BalanceSheetReportResponse>('/reports/balance-sheet', { params: filters })
      return data.report
    },
    staleTime: 0,
  }
}

export function trialBalanceReportQueryOptions(filters: TrialBalanceReportFilters) {
  return {
    queryKey: ['reports', 'trial-balance', filters.as_of, filters.fund_id ?? null] as const,
    queryFn: async () => {
      const { data } = await client.get<TrialBalanceReportResponse>('/reports/trial-balance', { params: filters })
      return data.report
    },
    staleTime: 0,
  }
}

export function usePLReport(filters: PLReportFilters, enabled = true) {
  return useQuery<PLReportResponse['report']>({
    ...plReportQueryOptions(filters),
    enabled,
  })
}

export function useBalanceSheetReport(filters: BalanceSheetReportFilters, enabled = true) {
  return useQuery<BalanceSheetReportResponse['report']>({
    ...balanceSheetReportQueryOptions(filters),
    enabled,
  })
}

export function useLedgerReport(filters: LedgerReportFilters, enabled = true) {
  return useQuery<LedgerReportResponse['report']>({
    queryKey: ['reports', 'ledger', filters.from, filters.to, filters.fund_id ?? null, filters.account_id ?? null],
    queryFn: async () => {
      const { data } = await client.get<LedgerReportResponse>('/reports/ledger', { params: filters })
      return data.report
    },
    enabled,
    staleTime: 0,
  })
}

export function useTrialBalanceReport(filters: TrialBalanceReportFilters, enabled = true) {
  return useQuery<TrialBalanceReportResponse['report']>({
    ...trialBalanceReportQueryOptions(filters),
    enabled,
  })
}

export async function getPLReport(queryClient: QueryClient, filters: PLReportFilters) {
  return queryClient.fetchQuery<PLReportResponse['report']>(plReportQueryOptions(filters))
}

export async function getBalanceSheetReport(queryClient: QueryClient, filters: BalanceSheetReportFilters) {
  return queryClient.fetchQuery<BalanceSheetReportResponse['report']>(balanceSheetReportQueryOptions(filters))
}

export async function getTrialBalanceReport(queryClient: QueryClient, filters: TrialBalanceReportFilters) {
  return queryClient.fetchQuery<TrialBalanceReportResponse['report']>(trialBalanceReportQueryOptions(filters))
}

export function useDonorSummaryReport(filters: DonorSummaryReportFilters, enabled = true) {
  return useQuery<DonorSummaryReportResponse['report']>({
    queryKey: ['reports', 'donors-summary', filters.from, filters.to, filters.fund_id ?? null, filters.account_ids ?? null],
    queryFn: async () => {
      const { data } = await client.get<DonorSummaryReportResponse>('/reports/donors/summary', { params: filters })
      return data.report
    },
    enabled,
    staleTime: 0,
  })
}

export function useDonorDetailReport(filters: DonorDetailReportFilters, enabled = true) {
  return useQuery<DonorDetailReportResponse['report']>({
    queryKey: [
      'reports',
      'donors-detail',
      filters.from,
      filters.to,
      filters.fund_id ?? null,
      filters.contact_id ?? null,
      filters.account_ids ?? null,
    ],
    queryFn: async () => {
      const { data } = await client.get<DonorDetailReportResponse>('/reports/donors/detail', { params: filters })
      return data.report
    },
    enabled,
    staleTime: 0,
  })
}
