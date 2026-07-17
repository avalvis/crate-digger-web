import { expect, test } from '@playwright/test'

test('navigates the core producer workflow', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /digital crate/i })).toBeVisible()
  await page.getByRole('link', { name: /manual rip/i }).click()
  await expect(page.getByRole('heading', { name: /paste it/i })).toBeVisible()
  await page.getByRole('link', { name: /vault/i }).click()
  await expect(page.getByText(/records in the vault/i)).toBeVisible()
})

