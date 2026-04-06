import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  AccountSummary,
  AccountType,
  AccountsListResponse,
  CreateAccountInput,
  UpdateAccountInput,
} from '../../../shared/contracts'

interface UseAccountsParams {
  type?: AccountType
  include_inactive?: boolean
}

interface UpdateAccountPayload extends UpdateAccountInput {
  id: number
}

export function useAccounts(params: UseAccountsParams = {}) {
  const query = new URLSearchParams()
  if (params.type) query.set('type', params.type)
  if (params.include_inactive) query.set('include_inactive', 'true')

  return useQuery<AccountSummary[]>({
    queryKey: ['accounts', params],
    queryFn: async () => {
      const { data } = await client.get<AccountsListResponse>(`/accounts?${query}`)
      return data.accounts
    },
  })
}

export function useCreateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateAccountInput) => {
      const { data } = await client.post<{ account: AccountSummary }>('/accounts', payload)
      return data.account
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'], exact: false }),
  })
}

export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateAccountPayload) => {
      const { data } = await client.put<{ account: AccountSummary }>(`/accounts/${id}`, payload)
      return data.account
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'], exact: false }),
  })
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await client.delete(`/accounts/${id}`)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'], exact: false }),
  })
}
