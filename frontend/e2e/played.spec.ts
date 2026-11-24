import { expect, test } from '@playwright/test'

const record = (id: string, artist: string, title: string, year: number) => ({
  discogs_master_id: year * 10 + title.length, discogs_release_id: null, artist, title, year, country: 'Greece',
  genre: 'Jazz', style: 'Soul-Jazz', youtube_url: `https://youtube.com/watch?v=${id}`, youtube_video_id: id,
  youtube_title: title, youtube_duration_seconds: 200, match_score: 0.92, sample_score: 0.9,
  sample_reasons: ['classic source era'], artwork_url: null, discogs_url: null, sample_friendly: true, demo: false,
})

const reel = [
  record('aaaaaaaaaa1', 'Mikis Ensemble', 'Night Harbour', 1972),
  record('aaaaaaaaaa2', 'Orchestra Nova', 'Bouzouki Break', 1969),
  record('aaaaaaaaaa3', 'Athens Jazz Trio', 'Slow Smoke', 1975),
  record('aaaaaaaaaa4', 'Studio 7', 'Library Theme No. 4', 1978),
]

test('played records leave the reel, grey out and remember what you kept', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    config: { general: {}, downloader: {}, stems: {}, discovery: {}, export: {}, ui: {} },
    has_discogs_token: true, has_deepseek_key: false, keyring_available: true, engine_ready: true, engine_error: null } }))
  await page.addInitScript((items) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('cratedigger.digitalCrate', JSON.stringify({ version: 1, state: {
      items, digRun: 1, appliedRun: 1, view: 'list', profile: 'boom_bap', era: 0, country: '', genre: '',
      message: null, demo: false, rejectedSources: {}, lockedSources: {},
      playedVideoIds: ['aaaaaaaaaa2', 'aaaaaaaaaa3'], listenedSeconds: { aaaaaaaaaa2: 3, aaaaaaaaaa3: 3 },
      likedVideoIds: ['aaaaaaaaaa2'],
    } }))
  }, reel)
  await page.goto('/')

  const played = page.getByRole('region', { name: 'Played from this crate' })
  await expect(played.getByRole('article', { name: /Played: Orchestra Nova — Bouzouki Break \(kept\)/ })).toBeVisible()
  await expect(played.getByRole('article', { name: /Played: Athens Jazz Trio — Slow Smoke$/ })).toBeVisible()
  // Up next only holds records you have not heard yet.
  const upNext = page.getByRole('region', { name: 'Up next' })
  await expect(upNext.getByText('Slow Smoke')).toHaveCount(0)
  await expect(upNext.getByText('Library Theme No. 4')).toBeVisible()
  if (process.env.PLAYED_SCREENSHOT) {
    await played.scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.PLAYED_SCREENSHOT, fullPage: false })
  }

  // Survives a restart (reload).
  await page.reload()
  await expect(page.getByRole('region', { name: 'Played from this crate' }).getByText('Bouzouki Break')).toBeVisible()
})
