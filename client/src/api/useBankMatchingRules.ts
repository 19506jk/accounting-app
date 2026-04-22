import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  BankMatchingRule,
  BankMatchingRuleDraft,
  BankMatchingRuleResponse,
  BankMatchingRulesResponse,
  MessageResponse,
  SimulateBankMatchingRuleInput,
  SimulateBankMatchingRuleResult,
} from '@shared/contracts'
import client from './client'

export function useBankMatchingRules(options?: { enabled?: boolean; includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive ?? true
  const query = new URLSearchParams()
  query.set('include_inactive', includeInactive ? 'true' : 'false')

  return useQuery<BankMatchingRule[]>({
    queryKey: ['bank-matching-rules', includeInactive],
    queryFn: async () => {
      const { data } = await client.get<BankMatchingRulesResponse>(`/bank-matching-rules?${query}`)
      return data.rules
    },
    enabled: options?.enabled ?? true,
  })
}

export function useCreateBankMatchingRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: BankMatchingRuleDraft) => {
      const { data } = await client.post<BankMatchingRuleResponse>('/bank-matching-rules', payload)
      return data.rule
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-matching-rules'] })
    },
  })
}

export function useUpdateBankMatchingRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: BankMatchingRuleDraft }) => {
      const { data } = await client.put<BankMatchingRuleResponse>(`/bank-matching-rules/${id}`, payload)
      return data.rule
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-matching-rules'] })
    },
  })
}

export function useDeleteBankMatchingRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await client.delete<MessageResponse>(`/bank-matching-rules/${id}`)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-matching-rules'] })
    },
  })
}

export function useSimulateBankMatchingRule() {
  return useMutation({
    mutationFn: async (payload: SimulateBankMatchingRuleInput) => {
      const { data } = await client.post<SimulateBankMatchingRuleResult>('/bank-matching-rules/simulate', payload)
      return data
    },
  })
}
