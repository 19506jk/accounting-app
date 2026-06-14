/**
 * Keep this env var in the parent Playwright process when overriding it so
 * config evaluation and child servers resolve the same origin.
 */
export const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174'
