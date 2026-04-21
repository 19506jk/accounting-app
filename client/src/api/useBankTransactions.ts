import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  BankConfirmInput,
  BankImportInput,
  BankImportResult,
  BankMatchResult,
  BankRejectInput,
  BankReserveInput,
  BankReviewDecision,
  BankTransaction,
  BankTransactionsListResponse,
  BankTransactionsQuery,
  BankUploadsListResponse,
  BankUploadSummary,
} from '@shared/contracts'

export function useBankTransactions(params: BankTransactionsQuery = {}, options?: { enabled?: boolean }) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      if (v.length > 0) query.set(k, v.join(','))
      return
    }
    if (v !== undefined && v !== '') query.set(k, String(v))
  })

  return useQuery<BankTransaction[]>({
    queryKey: ['bank-transactions', params],
    queryFn: async () => {
      const { data } = await client.get<BankTransactionsListResponse>(`/bank-transactions?${query}`)
      return data.items
    },
    enabled: options?.enabled ?? true,
  })
}

export function useBankUploads() {
  return useQuery<BankUploadSummary[]>({
    queryKey: ['bank-uploads'],
    queryFn: async () => {
      const { data } = await client.get<BankUploadsListResponse>('/bank-transactions/uploads')
      return data.uploads
    },
  })
}

export function useImportBankTransactions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: BankImportInput) => {
      const { data } = await client.post<BankImportResult>('/bank-transactions/import', payload)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['bank-uploads'] })
    },
  })
}

export function useReviewBankTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: BankReviewDecision['decision'] }) => {
      const { data } = await client.put<{ item: BankTransaction }>(`/bank-transactions/${id}/review`, { decision })
      return data.item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['bank-uploads'] })
    },
  })
}

export function useScanCandidates() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await client.post<BankMatchResult>(`/bank-transactions/${id}/scan`)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] })
    },
  })
}

export function useReserve() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: BankReserveInput }) => {
      const { data } = await client.post<{ item: BankTransaction }>(`/bank-transactions/${id}/reserve`, payload)
      return data.item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] })
    },
  })
}

export function useConfirmMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: BankConfirmInput }) => {
      const { data } = await client.post<{ item: BankTransaction }>(`/bank-transactions/${id}/confirm`, payload)
      return data.item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] })
    },
  })
}

export function useRejectCandidate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: BankRejectInput }) => {
      const { data } = await client.post<{ item: BankTransaction }>(`/bank-transactions/${id}/reject`, payload)
      return data.item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] })
    },
  })
}

export function useReleaseReservation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await client.post<{ item: BankTransaction }>(`/bank-transactions/${id}/release`)
      return data.item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] })
    },
  })
}
