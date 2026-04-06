import { createContext, useContext, useEffect, useMemo } from 'react'
import { useSettings } from '../api/useSettings'
import { useAuth } from './AuthContext'
import {
  DEFAULT_CHURCH_TIMEZONE,
  isValidTimeZone,
  setChurchTimeZone,
  getChurchTimeZone,
} from '../utils/date'

interface DateContextValue {
  churchTimeZone: string
}

const DateContext = createContext<DateContextValue | null>(null)

export function DateProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isInitialLoading } = useAuth()
  const shouldLoadSettings = isAuthenticated && !isInitialLoading
  const { data: settings } = useSettings(shouldLoadSettings)

  useEffect(() => {
    const configured = settings?.church_timezone
    if (isValidTimeZone(configured)) {
      setChurchTimeZone(configured)
      return
    }
    setChurchTimeZone(DEFAULT_CHURCH_TIMEZONE)
  }, [settings?.church_timezone])

  const value = useMemo<DateContextValue>(() => ({
    churchTimeZone: getChurchTimeZone(),
  }), [settings?.church_timezone])

  return <DateContext.Provider value={value}>{children}</DateContext.Provider>
}

export function useChurchDateConfig() {
  const ctx = useContext(DateContext)
  if (!ctx) throw new Error('useChurchDateConfig must be used within DateProvider')
  return ctx
}
