import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from './client';

export function useTransactions(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') query.set(k, v); });
  return useQuery({
    queryKey: ['transactions', params],
    queryFn:  async () => {
      const { data } = await client.get(`/transactions?${query}`);
      return data;
    },
  });
}

export function useTransaction(id) {
  return useQuery({
    queryKey: ['transactions', id],
    queryFn:  async () => {
      const { data } = await client.get(`/transactions/${id}`);
      return data.transaction;
    },
    enabled: !!id,
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await client.post('/transactions', payload);
      return data.transaction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data } = await client.put(`/transactions/${id}`, payload);
      return data.transaction;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions'] }),
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await client.delete(`/transactions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}
