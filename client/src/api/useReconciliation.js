import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from './client';

export function useReconciliations() {
  return useQuery({
    queryKey: ['reconciliations'],
    queryFn:  async () => {
      const { data } = await client.get('/reconciliations');
      return data.reconciliations;
    },
  });
}

export function useReconciliation(id) {
  return useQuery({
    queryKey: ['reconciliation', id],
    queryFn:  async () => {
      const { data } = await client.get(`/reconciliations/${id}`);
      return data.reconciliation;
    },
    enabled: !!id,
  });
}

export function useCreateReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await client.post('/reconciliations', payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliations'] }),
  });
}

export function useUpdateReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data } = await client.put(`/reconciliations/${id}`, payload);
      return data.reconciliation;
    },
    onSuccess: (_, { id }) => queryClient.invalidateQueries({ queryKey: ['reconciliation', id] }),
  });
}

export function useClearItem(reconciliationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId }) => {
      const { data } = await client.post(
        `/reconciliations/${reconciliationId}/items/${itemId}/clear`
      );
      return data;
    },
    // Optimistic update — flip is_cleared immediately, recalculate difference
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: ['reconciliation', reconciliationId] });
      const prev = queryClient.getQueryData(['reconciliation', reconciliationId]);

      queryClient.setQueryData(['reconciliation', reconciliationId], (old) => {
        if (!old) return old;
        const items = old.items.map((item) =>
          item.id === itemId ? { ...item, is_cleared: !item.is_cleared } : item
        );
        return { ...old, items };
      });

      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['reconciliation', reconciliationId], context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation', reconciliationId] });
    },
  });
}

export function useCloseReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await client.post(`/reconciliations/${id}/close`);
      return data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['reconciliations'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation', id] });
    },
  });
}

export function useDeleteReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await client.delete(`/reconciliations/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliations'] }),
  });
}
