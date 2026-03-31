import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from './client';

export function useBills(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') query.set(k, v);
  });

  return useQuery({
    queryKey: ['bills', params],
    queryFn:  async () => {
      const { data } = await client.get(`/bills?${query}`);
      return data.bills;
    },
  });
}

export function useBill(id) {
  return useQuery({
    queryKey: ['bills', id],
    queryFn:  async () => {
      const { data } = await client.get(`/bills/${id}`);
      return data.bill;
    },
    enabled: !!id,
  });
}

export function useBillSummary() {
  return useQuery({
    queryKey: ['bills', 'summary'],
    queryFn:  async () => {
      const { data } = await client.get('/bills/summary');
      return data.summary;
    },
  });
}

export function useAgingReport(asOfDate) {
  return useQuery({
    queryKey: ['bills', 'aging', asOfDate],
    queryFn:  async () => {
      const q = asOfDate ? `?as_of=${asOfDate}` : '';
      const { data } = await client.get(`/bills/reports/aging${q}`);
      return data.report;
    },
  });
}

export function useCreateBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await client.post('/bills', payload);
      return data.bill;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useUpdateBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data } = await client.put(`/bills/${id}`, payload);
      return data.bill;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function usePayBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data } = await client.post(`/bills/${id}/pay`, payload);
      return data.bill;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useVoidBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await client.post(`/bills/${id}/void`);
      return data.bill;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}
