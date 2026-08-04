import '@vitest/browser/matchers'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from 'vitest-browser-react/pure'

import { worker } from './msw/browser'

beforeAll(async () => {
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
})

afterEach(async () => {
  try {
    await cleanup()
    worker.resetHandlers()
    localStorage.clear()
  } finally {
    // A failed test must not leave a fake clock behind for the next file
    // (browser mode shares the page context across files).
    vi.useRealTimers()
  }
})
afterAll(() => worker.stop())
