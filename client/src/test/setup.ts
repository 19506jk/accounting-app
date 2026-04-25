import '@vitest/browser/matchers'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

import { worker } from './msw/browser'

beforeAll(async () => {
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
})
afterEach(() => {
  worker.resetHandlers()
  localStorage.clear()
})
afterAll(() => worker.stop())
beforeEach(() => localStorage.clear())
