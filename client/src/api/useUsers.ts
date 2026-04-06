import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  CreateUserInput,
  Role,
  UpdateUserActiveInput,
  UpdateUserRoleInput,
  UserSummary,
} from '../../../shared/contracts'

interface UserIdPayload {
  id: number
}

interface UpdateUserRolePayload extends UserIdPayload, UpdateUserRoleInput {}
interface UpdateUserActivePayload extends UserIdPayload, UpdateUserActiveInput {}

export function useUsers() {
  return useQuery<UserSummary[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await client.get<{ users: UserSummary[] }>('/users')
      return data.users
    },
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ email, role }: CreateUserInput) => {
      const { data } = await client.post<{ user: UserSummary }>('/users', { email, role })
      return data.user
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, role }: UpdateUserRolePayload) => {
      const { data } = await client.put<{ user: UserSummary }>(`/users/${id}/role`, { role })
      return data.user
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useUpdateUserActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, is_active }: UpdateUserActivePayload) => {
      const { data } = await client.put<{ user: UserSummary }>(`/users/${id}/active`, { is_active })
      return data.user
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await client.delete(`/users/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export type { Role }
