import { expect, test } from '@playwright/test'

const restartRequired = {
  state: 'ready', checked_at: null, message: 'Updated tools are ready.', restart_required: true, can_rollback: true,
  tools: [{ id: 'yt-dlp', name: 'YouTube downloader', installed_version: '2026.10.26', latest_version: '2026.10.26',
    status: 'ready', update_supported: true, optional: false, detail: 'Installed' }],
}

test('tool banner stays one compact line and the page keeps its space', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/tools', (route) => route.fulfill({ json: restartRequired }))
  await page.goto('/')
  const banner = page.locator('.tool-banner')
  await expect(banner).toBeVisible()
  const bannerBox = await banner.boundingBox()
  expect(bannerBox!.height).toBeLessThan(48)

  // The content area must fill everything below the banner, not an implicit row.
  const contentBox = await page.locator('.content-scroll').boundingBox()
  const mainBox = await page.locator('.app-main').boundingBox()
  expect(contentBox!.y).toBeCloseTo(bannerBox!.y + bannerBox!.height, 0)
  expect(contentBox!.y + contentBox!.height).toBeCloseTo(mainBox!.y + mainBox!.height, 0)
  if (process.env.LAYOUT_SCREENSHOT) await page.screenshot({ path: process.env.LAYOUT_SCREENSHOT })

  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(banner).toBeHidden()
  const expanded = await page.locator('.content-scroll').boundingBox()
  expect(expanded!.y).toBeLessThan(contentBox!.y)
})
