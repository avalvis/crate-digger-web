import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

class FakeSocket {
  static instances: FakeSocket[] = []
  url: string
  onopen?: () => void
  onmessage?: (message: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  closed = false
  constructor(url: URL | string) {
    this.url = String(url)
    FakeSocket.instances.push(this)
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
  send(data: unknown) { return data }
  emit(payload: unknown) { this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) }) }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  invoke.mockReset()
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete window.__TAURI_INTERNALS__
})

describe('engine address', () => {
  it('waits until the engine reports its port', async () => {
    invoke
      .mockResolvedValueOnce({ baseUrl: '', token: 't' })
      .mockResolvedValueOnce({ baseUrl: '', token: 't' })
      .mockResolvedValue({ baseUrl: 'http://127.0.0.1:5000', token: 't' })
    const { runtimeConfig } = await import('./api')
    const pending = runtimeConfig()
    await vi.advanceTimersByTimeAsync(600)
    await expect(pending).resolves.toEqual({ baseUrl: 'http://127.0.0.1:5000', token: 't' })
  })

  it('reads the new address after a restart', async () => {
    invoke.mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:5000', token: 't' })
      .mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:6000', token: 't' })
    const { resetRuntime, runtimeConfig } = await import('./api')
    expect((await runtimeConfig()).baseUrl).toBe('http://127.0.0.1:5000')
    resetRuntime()
    expect((await runtimeConfig()).baseUrl).toBe('http://127.0.0.1:6000')
  })
})

describe('event stream', () => {
  async function open() {
    invoke.mockResolvedValue({ baseUrl: 'http://127.0.0.1:5000', token: 't' })
    const { connectEvents } = await import('./api')
    const handlers = { onEvent: vi.fn(), onConnected: vi.fn(), onStatus: vi.fn() }
    const stop = await connectEvents(handlers)
    await vi.advanceTimersByTimeAsync(0)
    const socket = FakeSocket.instances.at(-1)!
    socket.onopen?.()
    return { handlers, socket, stop }
  }

  it('ignores heartbeats and malformed frames, and resyncs after a gap', async () => {
    const { handlers, socket, stop } = await open()
    expect(handlers.onConnected).toHaveBeenCalledTimes(1)
    socket.emit({ type: 'ping' })
    socket.emit('{not json')
    socket.emit({ type: 'job_progress', seq: 1 })
    socket.emit({ type: 'job_progress', seq: 2 })
    expect(handlers.onConnected).toHaveBeenCalledTimes(1)
    socket.emit({ type: 'job_progress', seq: 7 })
    expect(handlers.onConnected).toHaveBeenCalledTimes(2)
    expect(handlers.onEvent).toHaveBeenCalledTimes(3)
    stop()
  })

  it('treats a silent socket as dead and reconnects with back-off', async () => {
    const { handlers, stop } = await open()
    expect(FakeSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(handlers.onStatus).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.instances[1].url).toContain('ws://127.0.0.1:5000/api/events')
    stop()
  })
})
