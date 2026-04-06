import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type { TaxRateResponse, TaxRatesListResponse, TaxRateSummary, UpdateTaxRateInput } from '@shared/contracts'

interface UseTaxRatesParams {
  activeOnly?: boolean
}

interface UpdateTaxRatePayload extends UpdateTaxRateInput {
  id: number
}

export function useTaxRates({ activeOnly = false }: UseTaxRatesParams = {}) {
  return useQuery<TaxRateSummary[]>({
    queryKey: ['tax-rates', { activeOnly }],
    queryFn: async () => {
      const { data } = await client.get<TaxRatesListResponse>('/tax-rates', {
        params: activeOnly ? {} : { all: true },
      })
      return data.tax_rates
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateTaxRate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, rate }: UpdateTaxRatePayload) => {
      const { data } = await client.put<TaxRateResponse>(`/tax-rates/${id}`, { rate })
      return data.tax_rate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] })
    },
  })
}

export function useToggleTaxRate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await client.patch<TaxRateResponse>(`/tax-rates/${id}/toggle`)
      return data.tax_rate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] })
    },
  })
}
