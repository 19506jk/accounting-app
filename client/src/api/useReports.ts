import { useQuery } from '@tanstack/react-query'
import client from './client'

import type {
  BalanceSheetReportFilters,
  BalanceSheetReportResponse,
  DonorDetailReportFilters,
  DonorDetailReportResponse,
  DonorSummaryReportResponse,
  LedgerReportFilters,
  LedgerReportResponse,
  PLReportFilters,
  PLReportResponse,
  TrialBalanceReportResponse,
} from '@shared/contracts'

export function usePLReport(filters: PLReportFilters, enabled?: boolean) {
  return useQuery<PLReportResponse['report']>({
    queryKey: ['report', 'pl', filters],
    queryFn: async () => {
      const { data } = await client.get<PLReportResponse>('/reports/pl', { params: filters })
      return data.report
    },
    enabled: !!enabled,
    staleTime: 0,
  })
}

export function useBalanceSheetReport(filters: BalanceSheetReportFilters, enabled?: boolean) {
  return useQuery<BalanceSheetReportResponse['report']>({
    queryKey: ['report', 'balance-sheet', filters],
    queryFn: async () => {
      const { data } = await client.get<BalanceSheetReportResponse>('/reports/balance-sheet', { params: filters })
      return data.report
    },
    enabled: !!enabled,
    staleTime: 0,
  })
}

export function useLedgerReport(filters: LedgerReportFilters, enabled?: boolean) {
  return useQuery<LedgerReportResponse['report']>({
    queryKey: ['report', 'ledger', filters],
    queryFn: async () => {
      const { data } = await client.get<LedgerReportResponse>('/reports/ledger', { params: filters })
      return data.report
    },
    enabled: !!enabled,
    staleTime: 0,
  })
}

export function useTrialBalanceReport(filters: PLReportFilters, enabled?: boolean) {
  return useQuery<TrialBalanceReportResponse['report']>({
    queryKey: ['report', 'trial-balance', filters],
    queryFn: async () => {
      const { data } = await client.get<TrialBalanceReportResponse>('/reports/trial-balance', { params: filters })
      return data.report
    },
    enabled: !!enabled,
    staleTime: 0,
  })
}

export function useDonorSummaryReport(filters: PLReportFilters, enabled?: boolean) {
  return useQuery<DonorSummaryReportResponse['report']>({
    queryKey: ['report', 'donors-summary', filters],
    queryFn: async () => {
      const { data } = await client.get<DonorSummaryReportResponse>('/reports/donors/summary', { params: filters })
      return data.report
    },
    enabled: !!enabled,
    staleTime: 0,
  })
}

export function useDonorDetailReport(filters: DonorDetailReportFilters, enabled?: boolean) {
  return useQuery<DonorDetailReportResponse['report']>({
    queryKey: ['report', 'donors-detail', filters],
    queryFn: async () => {
      const { data } = await client.get<DonorDetailReportResponse>('/reports/donors/detail', { params: filters })
      return data.report
    },
    enabled: !!enabled,
    staleTime: 0,
  })
}
