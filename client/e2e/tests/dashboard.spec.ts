import { expect, test } from '@playwright/test'

test('authenticated user lands on dashboard', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in with google/i })).not.toBeVisible()
})
