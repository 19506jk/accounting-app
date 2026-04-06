import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import client from '../api/client'

import type { AuthMeResponse, AuthUser } from '@shared/contracts'

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  isInitialLoading: boolean
  isAuthenticated: boolean
  login: (newToken: string, newUser: AuthUser) => void
  logout: () => void
  clearAuth: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)

  const clearAuth = useCallback(() => {
    localStorage.removeItem('church_token')
    localStorage.removeItem('church_user')
    setToken(null)
    setUser(null)
  }, [])

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    localStorage.setItem('church_token', newToken)
    localStorage.setItem('church_user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }, [])

  const logout = useCallback(() => {
    clearAuth()
    window.location.href = '/login'
  }, [clearAuth])

  useEffect(() => {
    const storedToken = localStorage.getItem('church_token')

    if (!storedToken) {
      setIsInitialLoading(false)
      return
    }

    setToken(storedToken)

    client
      .get<AuthMeResponse>('/auth/me')
      .then(({ data }) => {
        setUser(data.user)
        localStorage.setItem('church_user', JSON.stringify(data.user))
      })
      .catch(() => {
        clearAuth()
      })
      .finally(() => {
        setIsInitialLoading(false)
      })
  }, [clearAuth])

  const value: AuthContextValue = {
    user,
    token,
    isInitialLoading,
    isAuthenticated: !!user,
    login,
    logout,
    clearAuth,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
