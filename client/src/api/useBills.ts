import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  BillAgingReportResponse,
  BillDetail,
  BillSummary,
  BillSummaryResponse,
  BillsQuery,
  CreateBillInput,
  PayBillInput,
  UpdateBillInput,
} from '../../../shared/contracts'

interface UpdateBillPayload extends UpdateBillInput {
  id: number
}

interface PayBillPayload extends PayBillInput {
  id: number
}

export function useBills(params: BillsQuery = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') query.set(k, String(v))
  })

  return useQuery<BillSummary[]>({
    queryKey: ['bills', params],
    queryFn: async () => {
      const { data } = await client.get<{ bills: BillSummary[] }>(`/bills?${query}`)
      return data.bills
    },
  })
}

export function useBill(id: number | null | undefined) {
  return useQuery<BillDetail>({
    queryKey: ['bills', id],
    queryFn: async () => {
      const { data } = await client.get<{ bill: BillDetail }>(`/bills/${id}`)
      return data.bill
    },
    enabled: !!id,
  })
}

export function useBillSummary() {
  return useQuery<BillSummaryResponse['summary']>({
    queryKey: ['bills', 'summary'],
    queryFn: async () => {
      const { data } = await client.get<BillSummaryResponse>('/bills/summary')
      return data.summary
    },
  })
}

export function useAgingReport(asOfDate?: string) {
  return useQuery<BillAgingReportResponse['report']>({
    queryKey: ['bills', 'aging', asOfDate],
    queryFn: async () => {
      const q = asOfDate ? `?as_of=${asOfDate}` : ''
      const { data } = await client.get<BillAgingReportResponse>(`/bills/reports/aging${q}`)
      return data.report
    },
  })
}

export function useCreateBill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateBillInput) => {
      const { data } = await client.post<{ bill: BillDetail }>('/bills', payload)
      return data.bill
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

export function useUpdateBill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateBillPayload) => {
      const { data } = await client.put<{ bill: BillDetail }>(`/bills/${id}`, payload)
      return data.bill
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

export function usePayBill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: PayBillPayload) => {
      const { data } = await client.post<{ bill: BillDetail }>(`/bills/${id}/pay`, payload)
      return data.bill
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

export function useVoidBill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await client.post<{ bill: BillDetail }>(`/bills/${id}/void`)
      return data.bill
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}
