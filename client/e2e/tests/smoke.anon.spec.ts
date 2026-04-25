import { expect, test } from '@playwright/test'

test('login page shows Google sign-in button', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible()
})
