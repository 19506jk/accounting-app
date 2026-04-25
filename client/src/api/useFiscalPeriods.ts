import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type { FiscalPeriod, ReopenFiscalPeriodBody } from '@shared/contracts'

export function useFiscalPeriods() {
  return useQuery<FiscalPeriod[]>({
    queryKey: ['fiscal-periods'],
    queryFn: async () => {
      const { data } = await client.get<{ fiscal_periods: FiscalPeriod[] }>('/fiscal-periods')
      return data.fiscal_periods
    },
  })
}

export function useReopenFiscalPeriod() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, reason_note }: { id: number; reason_note: string }) => {
      await client.delete(`/fiscal-periods/${id}/reopen`, {
        data: { reason_note } satisfies ReopenFiscalPeriodBody,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fiscal-periods'] })
    },
  })
}
