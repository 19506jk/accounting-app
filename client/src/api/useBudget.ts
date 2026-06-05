import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type { AccountBudgetRow, BudgetResponse } from '@shared/contracts'

export function useBudget(fiscalYear: number, enabled = true) {
  return useQuery<AccountBudgetRow[]>({
    queryKey: ['budgets', fiscalYear],
    queryFn: async () => {
      const { data } = await client.get<BudgetResponse>('/budgets', { params: { fiscal_year: fiscalYear } })
      return data.rows
    },
    enabled: enabled && fiscalYear > 0,
    staleTime: 0,
  })
}

export function useUpdateBudget() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ accountId, fiscalYear, amount }: { accountId: number; fiscalYear: number; amount: number }) => {
      await client.put(`/budgets/${accountId}`, { fiscal_year: fiscalYear, amount })
    },
    onSuccess: (_data, { fiscalYear }) => {
      queryClient.invalidateQueries({ queryKey: ['budgets', fiscalYear] })
    },
  })
}
