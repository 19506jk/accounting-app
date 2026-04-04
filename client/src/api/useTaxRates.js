import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from './client';

/**
 * useTaxRates — fetch all tax rates (including inactive) for the Settings screen.
 * Pass { activeOnly: true } to get only active rates (for bill entry dropdown).
 */
export function useTaxRates({ activeOnly = false } = {}) {
  return useQuery({
    queryKey: ['tax-rates', { activeOnly }],
    queryFn:  async () => {
      const { data } = await client.get('/tax-rates', {
        params: activeOnly ? {} : { all: true },
      });
      return data.tax_rates;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * useUpdateTaxRate — update the rate value (percentage) of a tax rate.
 * Payload: { rate: 0.1300 }
 */
export function useUpdateTaxRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, rate }) => {
      const { data } = await client.put(`/tax-rates/${id}`, { rate });
      return data.tax_rate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    },
  });
}

/**
 * useToggleTaxRate — activate or deactivate a tax rate.
 */
export function useToggleTaxRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await client.patch(`/tax-rates/${id}/toggle`);
      return data.tax_rate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    },
  });
}
