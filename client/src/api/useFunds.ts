import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  CreateFundInput,
  FundSummary,
  NetAssetAccountSummary,
  UpdateFundInput,
} from '../../../shared/contracts'

interface UseFundsParams {
  include_inactive?: boolean
}

interface CreateFundResponse {
  fund: FundSummary
  equityAccount: NetAssetAccountSummary
}

interface UpdateFundPayload extends UpdateFundInput {
  id: number
}

export function useFunds(params: UseFundsParams = {}) {
  const query = new URLSearchParams()
  if (params.include_inactive) query.set('include_inactive', 'true')

  return useQuery<FundSummary[]>({
    queryKey: ['funds', params],
    queryFn: async () => {
      const { data } = await client.get<{ funds: FundSummary[] }>(`/funds?${query}`)
      return data.funds
    },
  })
}

export function useCreateFund() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateFundInput) => {
      const { data } = await client.post<CreateFundResponse>('/funds', payload)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funds'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useUpdateFund() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateFundPayload) => {
      const { data } = await client.put<{ fund: FundSummary }>(`/funds/${id}`, payload)
      return data.fund
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funds'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useDeleteFund() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await client.delete(`/funds/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funds'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}
