import type {
  ConfigResponse,
  Crate,
  DiscoveryResponse,
  PreviewResponse,
  QueueEvent,
  QueueJob,
  Track,
  TrackPage,
} from './types'

interface RuntimeConfig { baseUrl: string; token: string }

let runtimePromise: Promise<RuntimeConfig> | undefined

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

async function loadRuntime(): Promise<RuntimeConfig> {
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<RuntimeConfig>('api_config')
  }
  return {
    baseUrl: import.meta.env.VITE_API_BASE_URL || '',
    token: import.meta.env.VITE_API_TOKEN || 'cratedigger-local',
  }
}

export function runtimeConfig() {
  runtimePromise ??= loadRuntime()
  return runtimePromise
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const runtime = await runtimeConfig()
  const requestUrl = `${runtime.baseUrl}${path}`
  const requestInit: RequestInit = {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Crate-Token': runtime.token,
        ...init.headers,
      },
  }
  const startupDeadline = Date.now() + 30_000
  let response: Response
  while (true) {
    try {
      response = await fetch(requestUrl, requestInit)
      break
    } catch (error) {
      // The packaged one-file Python engine needs a few seconds to extract on
      // first launch. Retry connection failures only; HTTP failures still
      // surface immediately and commands are never replayed after a response.
      if (!window.__TAURI_INTERNALS__ || Date.now() >= startupDeadline) throw error
      await delay(350)
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    throw new Error(detail?.message || detail || `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function mediaUrl(path: string): Promise<string> {
  const runtime = await runtimeConfig()
  const joiner = path.includes('?') ? '&' : '?'
  return `${runtime.baseUrl}${path}${joiner}token=${encodeURIComponent(runtime.token)}`
}

export const api = {
  config: () => request<ConfigResponse>('/api/config'),
  patchConfig: (section: string, values: Record<string, unknown>) =>
    request<ConfigResponse>('/api/config', { method: 'PATCH', body: JSON.stringify({ section, values }) }),
  setSecret: (name: 'discogs' | 'deepseek', value: string) =>
    request<ConfigResponse>(`/api/config/secrets/${name}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  tracks: (query = '') => request<TrackPage>(`/api/tracks?limit=250&query=${encodeURIComponent(query)}`),
  patchTrack: (id: number, values: Partial<Pick<Track, 'rating' | 'notes' | 'tags'>>) =>
    request<Track>(`/api/tracks/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  jobs: () => request<QueueJob[]>('/api/jobs'),
  enqueue: (values: Record<string, unknown>) =>
    request<QueueJob>('/api/jobs', { method: 'POST', body: JSON.stringify(values) }),
  cancelJob: (id: number) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  dig: (values: Record<string, unknown>) =>
    request<DiscoveryResponse>('/api/discovery/dig', { method: 'POST', body: JSON.stringify(values) }),
  preview: (videoId: string) => request<PreviewResponse>(`/api/previews/${videoId}`, { method: 'POST' }),
  crates: () => request<Crate[]>('/api/crates'),
  createCrate: (name: string, description?: string) =>
    request<Crate>('/api/crates', { method: 'POST', body: JSON.stringify({ name, description }) }),
  addToCrate: (crateId: number, trackIds: number[]) =>
    request<{ added: number }>(`/api/crates/${crateId}/tracks`, { method: 'POST', body: JSON.stringify({ track_ids: trackIds }) }),
  deleteCrate: (crateId: number) => request<void>(`/api/crates/${crateId}`, { method: 'DELETE' }),
  exportTracks: (trackIds: number[], destination: string) =>
    request<{ accepted: number; message: string }>('/api/exports', {
      method: 'POST', body: JSON.stringify({ track_ids: trackIds, destination, chop_kit: false }),
    }),
}

export async function connectEvents(onEvent: (event: QueueEvent) => void): Promise<() => void> {
  const runtime = await runtimeConfig()
  const base = runtime.baseUrl || window.location.origin
  const url = new URL('/api/events', base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('token', runtime.token)
  let socket: WebSocket | undefined
  let closed = false
  let retry: number | undefined

  const connect = () => {
    if (closed) return
    socket = new WebSocket(url)
    socket.onmessage = (message) => onEvent(JSON.parse(message.data) as QueueEvent)
    socket.onclose = () => {
      if (!closed) retry = window.setTimeout(connect, 1500)
    }
  }
  connect()
  return () => {
    closed = true
    if (retry) window.clearTimeout(retry)
    socket?.close()
  }
}
