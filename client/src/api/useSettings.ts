import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type { SettingsResponse, SettingsValues, UpdateSettingsInput } from '@shared/contracts'

export function useSettings() {
  return useQuery<SettingsValues>({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data } = await client.get<SettingsResponse>('/settings')
      return data.values
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (updates: UpdateSettingsInput) => {
      const { data } = await client.put<SettingsResponse>('/settings', updates)
      return data.values
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}
