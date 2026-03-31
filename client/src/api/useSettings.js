import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from './client';

/**
 * useSettings — fetch all church settings as a flat key-value object.
 * Cached globally so the PDF generator in Module 10b can reuse it.
 */
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn:  async () => {
      const { data } = await client.get('/settings');
      return data.values; // { church_name: '...', church_city: '...', ... }
    },
    staleTime: 5 * 60 * 1000, // 5 min — settings don't change often
  });
}

/**
 * useUpdateSettings — bulk update settings.
 * Accepts a flat key-value object: { church_name: 'Grace Church', ... }
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates) => {
      const { data } = await client.put('/settings', updates);
      return data.values;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
