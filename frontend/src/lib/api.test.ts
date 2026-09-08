import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  invoke.mockReset().mockResolvedValue({ baseUrl: 'http://127.0.0.1:12345', token: 'test' })
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete window.__TAURI_INTERNALS__
})

describe('desktop backend startup', () => {
  it('shares readiness checks and loads settings after a slow cold start', async () => {
    const started = Date.now()
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/api/health') && Date.now() - started < 45_000) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ loaded: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const { api } = await import('./api')
    const requests = Promise.all([api.config(), api.config()])
    await vi.advanceTimersByTimeAsync(44_000)
    expect(fetcher.mock.calls.every(([url]) => url.endsWith('/api/health'))).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(requests).resolves.toEqual([{ loaded: true }, { loaded: true }])
    expect(invoke).toHaveBeenCalledTimes(1)
    const healthCalls = fetcher.mock.calls.filter(([url]) => url.endsWith('/api/health'))
    expect(healthCalls.length).toBeLessThan(140)
  })

  it('does not replay a command after an ambiguous network failure', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/api/health')) return new Response('{}')
      throw new TypeError('Connection lost after sending command')
    })
    vi.stubGlobal('fetch', fetcher)
    const { api } = await import('./api')
    await expect(api.patchConfig('general', { concurrent_workers: 2 })).rejects.toThrow('Connection lost')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('allows another attempt after runtime discovery fails', async () => {
    invoke.mockRejectedValueOnce(new Error('IPC unavailable'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    const { runtimeConfig } = await import('./api')
    await expect(runtimeConfig()).rejects.toThrow('IPC unavailable')
    await expect(runtimeConfig()).resolves.toHaveProperty('baseUrl')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('reports startup timeout and permits recovery on a later request', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetcher)
    const { api } = await import('./api')
    const failure = expect(api.config()).rejects.toThrow('could not finish starting')
    await vi.advanceTimersByTimeAsync(121_000)
    await failure
    fetcher.mockImplementation(async () => new Response('{}'))
    await expect(api.config()).resolves.toEqual({})
  })
})
