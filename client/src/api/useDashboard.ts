import { useQuery } from '@tanstack/react-query'
import client from './client'

import type {
  BalanceSheetReportData,
  BalanceSheetReportResponse,
  PLReportData,
  PLReportResponse,
  TransactionListItem,
} from '@shared/contracts'
import { currentMonthRange, getChurchToday } from '../utils/date'

function currentMonth() {
  return currentMonthRange()
}

export function usePLSummary() {
  const { from, to } = currentMonth()

  return useQuery<PLReportData>({
    queryKey: ['reports', 'pl', from, to],
    queryFn: async () => {
      const { data } = await client.get<PLReportResponse>('/reports/pl', {
        params: { from, to },
      })
      return data.report.data
    },
  })
}

export function useBalanceSheet() {
  const today = getChurchToday()

  return useQuery<BalanceSheetReportData>({
    queryKey: ['reports', 'balance-sheet', today],
    queryFn: async () => {
      const { data } = await client.get<BalanceSheetReportResponse>('/reports/balance-sheet', {
        params: { as_of: today },
      })
      return data.report.data
    },
  })
}

export function useRecentTransactions(limit = 10) {
  return useQuery<TransactionListItem[]>({
    queryKey: ['transactions', 'recent', limit],
    queryFn: async () => {
      const { data } = await client.get<{ transactions: TransactionListItem[] }>('/transactions', {
        params: { limit },
      })
      return data.transactions
    },
  })
}
