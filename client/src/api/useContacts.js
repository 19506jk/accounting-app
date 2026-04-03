import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from './client';

export function useContacts(params = {}) {
  const query = new URLSearchParams();
  if (params.search)           query.set('search',           params.search);
  if (params.type)             query.set('type',             params.type);
  if (params.class)            query.set('class',            params.class);
  if (params.include_inactive) query.set('include_inactive', 'true');

  return useQuery({
    queryKey: ['contacts', params],
    queryFn:  async () => {
      const { data } = await client.get(`/contacts?${query}`);
      return data.contacts;
    },
  });
}

export function useContact(id) {
  return useQuery({
    queryKey: ['contacts', id],
    queryFn:  async () => {
      const { data } = await client.get(`/contacts/${id}`);
      return data.contact;
    },
    enabled: !!id,
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await client.post('/contacts', payload);
      return data.contact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data } = await client.put(`/contacts/${id}`, payload);
      return data.contact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await client.delete(`/contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useContactDonations(id, year) {
  return useQuery({
    queryKey: ['contacts', id, 'donations', year],
    queryFn:  async () => {
      const q = year ? `?year=${year}` : '';
      const { data } = await client.get(`/contacts/${id}/donations${q}`);
      return data.donations;
    },
    enabled: !!id,
  });
}

export function useDonationReceipt(id, year) {
  return useQuery({
    queryKey: ['contacts', id, 'receipt', year],
    queryFn:  async () => {
      const { data } = await client.get(`/contacts/${id}/receipt?year=${year}`);
      return data.receipt;
    },
    enabled: !!id && !!year,
  });
}
