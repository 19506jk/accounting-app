import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from './client';

export function useAccounts(params = {}) {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  return useQuery({
    queryKey: ['accounts', params],
    queryFn:  async () => {
      const { data } = await client.get(`/accounts?${query}`);
      return data.accounts;
    },
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await client.post('/accounts', payload);
      return data.account;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data } = await client.put(`/accounts/${id}`, payload);
      return data.account;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await client.delete(`/accounts/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });
}
