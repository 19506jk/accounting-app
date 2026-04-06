import axios, { AxiosHeaders } from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'
let isRedirecting = false

const client = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.request.use((config) => {
  const headers = AxiosHeaders.from(config.headers)
  // Keep reading token from storage per-request so auth changes are picked up immediately.
  const token = localStorage.getItem('church_token')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  config.headers = headers
  return config
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    // TODO: add refresh-token flow before forcing logout on expired access tokens.
    if (error.response?.status === 401 && !isRedirecting) {
      isRedirecting = true
      localStorage.removeItem('church_token')
      localStorage.removeItem('church_user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default client
