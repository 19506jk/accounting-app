import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  CreateTransactionInput,
  TransactionCreateResult,
  TransactionDetail,
  TransactionsListResponse,
  TransactionsQuery,
  UpdateTransactionInput,
} from '@shared/contracts'

interface UpdateTransactionPayload extends UpdateTransactionInput {
  id: number
}

export function useTransactions(params: TransactionsQuery = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') query.set(k, String(v))
  })

  return useQuery<TransactionsListResponse>({
    queryKey: ['transactions', params],
    queryFn: async () => {
      const { data } = await client.get<TransactionsListResponse>(`/transactions?${query}`)
      return data
    },
  })
}

export function useTransaction(id: number | null | undefined) {
  return useQuery<TransactionDetail>({
    queryKey: ['transactions', id],
    queryFn: async () => {
      const { data } = await client.get<{ transaction: TransactionDetail }>(`/transactions/${id}`)
      return data.transaction
    },
    enabled: !!id,
  })
}

export function useCreateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateTransactionInput) => {
      const { data } = await client.post<{ transaction: TransactionCreateResult }>('/transactions', payload)
      return data.transaction
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateTransactionPayload) => {
      const { data } = await client.put<{ transaction: TransactionDetail }>(`/transactions/${id}`, payload)
      return data.transaction
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions'] }),
  })
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await client.delete(`/transactions/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}
