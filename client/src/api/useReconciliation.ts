import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  CloseReconciliationResponse,
  CreateReconciliationInput,
  CreateReconciliationResponse,
  ReconciliationDetail,
  ReconciliationItemToggleResponse,
  ReconciliationReport,
  ReconciliationReportResponse,
  ReconciliationSummary,
  UpdateReconciliationInput,
} from '@shared/contracts'

interface UpdateReconciliationPayload extends UpdateReconciliationInput {
  id: number
}

interface ClearItemPayload {
  itemId: number
}

function reconciliationReportQueryOptions(id: number) {
  return {
    queryKey: ['reconciliation-report', id],
    queryFn: async () => {
      const { data } = await client.get<ReconciliationReportResponse>(`/reconciliations/${id}/report`)
      return data.report
    },
  }
}

export function useReconciliations() {
  return useQuery<ReconciliationSummary[]>({
    queryKey: ['reconciliations'],
    queryFn: async () => {
      const { data } = await client.get<{ reconciliations: ReconciliationSummary[] }>('/reconciliations')
      return data.reconciliations
    },
  })
}

export function useReconciliation(id: number | null | undefined) {
  return useQuery<ReconciliationDetail>({
    queryKey: ['reconciliation', id],
    queryFn: async () => {
      const { data } = await client.get<{ reconciliation: ReconciliationDetail }>(`/reconciliations/${id}`)
      return data.reconciliation
    },
    enabled: !!id,
  })
}

export function useCreateReconciliation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateReconciliationInput) => {
      const { data } = await client.post<CreateReconciliationResponse>('/reconciliations', payload)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliations'] }),
  })
}

export function useUpdateReconciliation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateReconciliationPayload) => {
      const { data } = await client.put<{ reconciliation: ReconciliationDetail }>(`/reconciliations/${id}`, payload)
      return data.reconciliation
    },
    onSuccess: (_, { id }) => queryClient.invalidateQueries({ queryKey: ['reconciliation', id] }),
  })
}

export function useClearItem(reconciliationId: number | string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId }: ClearItemPayload) => {
      const { data } = await client.post<ReconciliationItemToggleResponse>(
        `/reconciliations/${reconciliationId}/items/${itemId}/clear`
      )
      return data
    },
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: ['reconciliation', reconciliationId] })
      const prev = queryClient.getQueryData<ReconciliationDetail>(['reconciliation', reconciliationId])

      queryClient.setQueryData<ReconciliationDetail | undefined>(['reconciliation', reconciliationId], (old) => {
        if (!old) return old
        const items = old.items.map((item) =>
          item.id === itemId ? { ...item, is_cleared: !item.is_cleared } : item
        )
        return { ...old, items }
      })

      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['reconciliation', reconciliationId], context.prev)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation', reconciliationId] })
    },
  })
}

export function useCloseReconciliation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await client.post<CloseReconciliationResponse>(`/reconciliations/${id}/close`)
      return data
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['reconciliations'] })
      queryClient.invalidateQueries({ queryKey: ['reconciliation', id] })
    },
  })
}

export function useDeleteReconciliation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await client.delete(`/reconciliations/${id}`)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliations'] }),
  })
}

export function useReconciliationReport(id: number | null | undefined) {
  return useQuery<ReconciliationReport>({
    ...reconciliationReportQueryOptions(id ?? 0),
    enabled: !!id,
  })
}

export async function getReconciliationReport(queryClient: QueryClient, id: number) {
  return queryClient.fetchQuery<ReconciliationReport>(reconciliationReportQueryOptions(id))
}
