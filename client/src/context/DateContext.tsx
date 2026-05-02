import { createContext, useContext, useEffect, useMemo } from 'react'
import { useSettings } from '../api/useSettings'
import { useAuth } from './AuthContext'
import {
  DEFAULT_CHURCH_TIMEZONE,
  isValidTimeZone,
  setChurchTimeZone,
} from '../utils/date'

interface DateContextValue {
  churchTimeZone: string
}

const DateContext = createContext<DateContextValue | null>(null)

export function DateProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isInitialLoading } = useAuth()
  const shouldLoadSettings = isAuthenticated && !isInitialLoading
  const { data: settings } = useSettings(shouldLoadSettings)
  const configuredChurchTimeZone = settings?.church_timezone
  const churchTimeZone = configuredChurchTimeZone && isValidTimeZone(configuredChurchTimeZone)
    ? configuredChurchTimeZone
    : DEFAULT_CHURCH_TIMEZONE

  useEffect(() => {
    setChurchTimeZone(churchTimeZone)
  }, [churchTimeZone])

  const value = useMemo<DateContextValue>(() => ({
    churchTimeZone,
  }), [churchTimeZone])

  return <DateContext.Provider value={value}>{children}</DateContext.Provider>
}

export function useChurchDateConfig() {
  const ctx = useContext(DateContext)
  if (!ctx) throw new Error('useChurchDateConfig must be used within DateProvider')
  return ctx
}
