import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from './client';

export function useFunds() {
  return useQuery({
    queryKey: ['funds'],
    queryFn:  async () => {
      const { data } = await client.get('/funds');
      return data.funds;
    },
  });
}

export function useCreateFund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await client.post('/funds', payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['funds'] }),
  });
}

export function useUpdateFund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data } = await client.put(`/funds/${id}`, payload);
      return data.fund;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['funds'] }),
  });
}

export function useDeleteFund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await client.delete(`/funds/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['funds'] }),
  });
}
