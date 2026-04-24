import { useQuery } from '@tanstack/react-query'
import client from './client'

import type {
  AccessLogQuery,
  AccessLogResponse,
  AuditLogQuery,
  AuditLogResponse,
} from '@shared/contracts'

function toQueryString<T extends object>(params: T) {
  const query = new URLSearchParams()
  Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    query.set(key, String(value))
  })
  return query.toString()
}

export function useForensicLog(params: AuditLogQuery = {}) {
  const query = toQueryString(params)

  return useQuery<AuditLogResponse>({
    queryKey: ['audit-log', 'forensic', params],
    queryFn: async () => {
      const suffix = query ? `?${query}` : ''
      const { data } = await client.get<AuditLogResponse>(`/audit-log${suffix}`)
      return data
    },
  })
}

export function useAccessLog(params: AccessLogQuery = {}) {
  const query = toQueryString(params)

  return useQuery<AccessLogResponse>({
    queryKey: ['audit-log', 'access', params],
    queryFn: async () => {
      const suffix = query ? `?${query}` : ''
      const { data } = await client.get<AccessLogResponse>(`/audit-log/access${suffix}`)
      return data
    },
  })
}
