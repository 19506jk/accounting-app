import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  ContactDetail,
  ContactDonation,
  ContactDonationsSummaryResponse,
  ContactReceipt,
  ContactSummary,
  ContactsQuery,
  CreateContactInput,
  UpdateContactInput,
} from '../../../shared/contracts'

interface UpdateContactPayload extends UpdateContactInput {
  id: number
}

export function useContacts(params: ContactsQuery = {}) {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.type) query.set('type', params.type)
  if (params.class) query.set('class', params.class)
  if (params.include_inactive) query.set('include_inactive', 'true')

  return useQuery<ContactSummary[]>({
    queryKey: ['contacts', params],
    queryFn: async () => {
      const { data } = await client.get<{ contacts: ContactSummary[] }>(`/contacts?${query}`)
      return data.contacts
    },
  })
}

export function useContact(id: number | null | undefined) {
  return useQuery<ContactDetail>({
    queryKey: ['contacts', id],
    queryFn: async () => {
      const { data } = await client.get<{ contact: ContactDetail }>(`/contacts/${id}`)
      return data.contact
    },
    enabled: !!id,
  })
}

export function useCreateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateContactInput) => {
      const { data } = await client.post<{ contact: ContactDetail }>('/contacts', payload)
      return data.contact
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export function useUpdateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateContactPayload) => {
      const { data } = await client.put<{ contact: ContactDetail }>(`/contacts/${id}`, payload)
      return data.contact
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export function useDeleteContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await client.delete(`/contacts/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export function useContactDonations(id: number | null | undefined, year?: number | string) {
  return useQuery<ContactDonation[]>({
    queryKey: ['contacts', id, 'donations', year],
    queryFn: async () => {
      const q = year ? `?year=${year}` : ''
      const { data } = await client.get<{ donations: ContactDonation[] }>(`/contacts/${id}/donations${q}`)
      return data.donations
    },
    enabled: !!id,
  })
}

export function useDonationReceipt(id: number | null | undefined, year?: number | string) {
  return useQuery<ContactReceipt>({
    queryKey: ['contacts', id, 'receipt', year],
    queryFn: async () => {
      const { data } = await client.get<{ receipt: ContactReceipt }>(`/contacts/${id}/receipt?year=${year}`)
      return data.receipt
    },
    enabled: !!id && !!year,
  })
}

export function useContactDonationSummary(id: number | null | undefined) {
  return useQuery<ContactDonationsSummaryResponse['summary']>({
    queryKey: ['contacts', id, 'donations', 'summary'],
    queryFn: async () => {
      const { data } = await client.get<ContactDonationsSummaryResponse>(`/contacts/${id}/donations/summary`)
      return data.summary
    },
    enabled: !!id,
  })
}
