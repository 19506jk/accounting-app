import { useQuery } from '@tanstack/react-query'
import client from './client'

import type {
  BalanceSheetReportData,
  BalanceSheetReportResponse,
  PLReportData,
  PLReportResponse,
  TransactionListItem,
} from '@shared/contracts'

function fmt(date: Date) {
  return date.toISOString().split('T')[0]
}

function currentMonth() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: fmt(start), to: fmt(now) }
}

export function usePLSummary() {
  const { from, to } = currentMonth()

  return useQuery<PLReportData>({
    queryKey: ['reports', 'pl', from, to],
    queryFn: async () => {
      const { data } = await client.get<PLReportResponse>(`/reports/pl?from=${from}&to=${to}`)
      return data.report.data
    },
  })
}

export function useBalanceSheet() {
  const today = fmt(new Date())

  return useQuery<BalanceSheetReportData>({
    queryKey: ['reports', 'balance-sheet', today],
    queryFn: async () => {
      const { data } = await client.get<BalanceSheetReportResponse>(`/reports/balance-sheet?as_of=${today}`)
      return data.report.data
    },
  })
}

export function useRecentTransactions(limit = 10) {
  return useQuery<TransactionListItem[]>({
    queryKey: ['transactions', 'recent', limit],
    queryFn: async () => {
      const { data } = await client.get<{ transactions: TransactionListItem[] }>(`/transactions?limit=${limit}`)
      return data.transactions
    },
  })
}
