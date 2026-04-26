import '@vitest/browser/matchers'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from 'vitest-browser-react'

import { worker } from './msw/browser'

beforeAll(async () => {
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
})
afterEach(() => {
  cleanup()
  worker.resetHandlers()
  localStorage.clear()
})
afterAll(() => worker.stop())
