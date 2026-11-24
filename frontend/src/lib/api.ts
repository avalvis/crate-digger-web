import type {
  ConfigResponse,
  Crate,
  CrateAssignmentResult,
  CrateDetail,
  CrateOverview,
  CrateSuggestion,
  DiscoveryResponse,
  DiscoveryInteraction,
  MpcExportMode,
  MpcJob,
  PreviewResponse,
  PreviewPrefetchResponse,
  QueueEvent,
  QueueJob,
  QueuePage,
  Track,
  TrackPage,
  ToolStatus,
  TrackLocation,
} from './types'

export interface RuntimeConfig { baseUrl: string; token: string }

let runtimePromise: Promise<RuntimeConfig> | undefined
let startupPromise: Promise<void> | undefined

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

async function loadRuntime(): Promise<RuntimeConfig> {
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core')
    // The engine reports its port once it is listening; wait for it.
    const deadline = Date.now() + 120_000
    for (;;) {
      const config = await invoke<RuntimeConfig>('api_config')
      if (config.baseUrl) return config
      if (Date.now() > deadline) throw new Error('Crate Digger could not finish starting. Close and reopen the app. Details are in crate-digger-startup.log in the app data folder.')
      await delay(250)
    }
  }
  return {
    baseUrl: import.meta.env.VITE_API_BASE_URL || '',
    token: import.meta.env.VITE_API_TOKEN || 'cratedigger-local',
  }
}

/** Forget the cached engine address, e.g. after the engine restarted on a new port. */
export function resetRuntime() {
  runtimePromise = undefined
  startupPromise = undefined
}

export function runtimeConfig() {
  runtimePromise ??= loadRuntime().catch((error) => {
    runtimePromise = undefined
    throw error
  })
  return runtimePromise
}

async function waitForDesktopBackend(runtime: RuntimeConfig) {
  if (!window.__TAURI_INTERNALS__) return
  startupPromise ??= (async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 120_000)
    try {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`${runtime.baseUrl}/api/health`, {
            signal: controller.signal,
            headers: { 'X-Crate-Token': runtime.token },
          })
          if (!response.ok) throw Object.assign(new Error(`Local startup check failed (${response.status})`), { status: response.status })
          return
        } catch (error) {
          if (error && typeof error === 'object' && 'status' in error) throw error
          if (!controller.signal.aborted) await delay(350)
        }
      }
      throw new Error('Crate Digger could not finish starting. Close and reopen the app. Details are in crate-digger-startup.log in the app data folder.')
    } finally {
      window.clearTimeout(timeout)
    }
  })().catch((error) => {
    startupPromise = undefined
    throw error
  })
  return startupPromise
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 90_000): Promise<T> {
  const runtime = await runtimeConfig()
  // One shared readiness check lets a cold one-file backend finish extracting
  // before settings/queue requests begin. Commands themselves are never retried.
  await waitForDesktopBackend(runtime)
  const requestUrl = `${runtime.baseUrl}${path}`
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  const requestInit: RequestInit = {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Crate-Token': runtime.token,
        ...init.headers,
      },
  }
  try {
    const response = await fetch(requestUrl, requestInit)
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const detail = body?.detail
      throw Object.assign(
        new Error(detail?.message || detail || `Request failed (${response.status})`),
        { status: response.status, code: detail?.code, detail },
      )
    }
    if (response.status === 204) return undefined as T
    return await response.json() as T
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('The local engine stopped responding. Nothing was changed; try the request again.')
    }
    if (error instanceof TypeError) {
      // fetch() rejects with TypeError when the engine is unreachable.
      throw Object.assign(
        new Error(`The audio engine is unreachable (${error.message}). It may be restarting; try again in a moment.`),
        { code: 'backend_unavailable' },
      )
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

/** URL for <audio>/<img>, which cannot send the session header. */
export function buildMediaUrl(runtime: RuntimeConfig, path: string): string {
  const joiner = path.includes('?') ? '&' : '?'
  return `${runtime.baseUrl}${path}${joiner}token=${encodeURIComponent(runtime.token)}`
}

export async function mediaUrl(path: string): Promise<string> {
  return buildMediaUrl(await runtimeConfig(), path)
}

export const api = {
  tools: () => request<ToolStatus>('/api/tools'),
  checkTools: () => request<ToolStatus>('/api/tools/check', { method: 'POST' }),
  updateTools: () => request<ToolStatus>('/api/tools/update', { method: 'POST' }),
  rollbackTools: () => request<ToolStatus>('/api/tools/rollback', { method: 'POST' }),
  config: () => request<ConfigResponse>('/api/config'),
  patchConfig: (section: string, values: Record<string, unknown>) =>
    request<ConfigResponse>('/api/config', { method: 'PATCH', body: JSON.stringify({ section, values }) }),
  setSecret: (name: 'discogs' | 'deepseek', value: string) =>
    request<ConfigResponse>(`/api/config/secrets/${name}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  tracks: (query = '', values: { crateId?: number; unassigned?: boolean; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams({ limit: String(values.limit || 250) })
    if (query) params.set('query', query)
    if (values.crateId !== undefined) params.set('crate_id', String(values.crateId))
    if (values.unassigned !== undefined) params.set('unassigned', String(values.unassigned))
    if (values.offset) params.set('offset', String(values.offset))
    return request<TrackPage>(`/api/tracks?${params}`)
  },
  track: (id: number) => request<Track>(`/api/tracks/${id}`),
  patchTrack: (id: number, values: Partial<Pick<Track, 'rating' | 'notes' | 'tags'>>) =>
    request<Track>(`/api/tracks/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  jobs: (values: { view?: 'queue' | 'history' | 'all'; query?: string; status?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams()
    if (values.view) params.set('view', values.view)
    if (values.query) params.set('query', values.query)
    if (values.status) params.set('status', values.status)
    if (values.limit) params.set('limit', String(values.limit))
    if (values.offset) params.set('offset', String(values.offset))
    return request<QueuePage>(`/api/jobs${params.size ? `?${params}` : ''}`)
  },
  enqueue: (values: Record<string, unknown>) =>
    request<QueueJob>('/api/jobs', { method: 'POST', body: JSON.stringify(values) }),
  cancelJob: (id: number) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  cancelAllJobs: () => request<{ affected: number }>('/api/jobs/cancel-all', { method: 'POST' }),
  retryJob: (id: number) => request<QueueJob>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  archiveJob: (id: number) => request<void>(`/api/jobs/${id}/archive`, { method: 'POST' }),
  archiveCompletedJobs: () => request<{ affected: number }>('/api/jobs/archive-completed', { method: 'POST' }),
  deleteJobHistory: () => request<{ affected: number }>('/api/jobs/history', { method: 'DELETE' }),
  dig: (values: Record<string, unknown>) =>
    request<DiscoveryResponse>('/api/discovery/dig', { method: 'POST', body: JSON.stringify(values) }, 180_000),
  recordListen: (suggestion: import('./types').Suggestion) =>
    request<void>('/api/listening/plays', { method: 'POST', body: JSON.stringify({ suggestion }) }),
  setLiked: (suggestion: import('./types').Suggestion, liked: boolean) =>
    request<void>('/api/listening/likes', { method: 'PUT', body: JSON.stringify({ suggestion, liked }) }),
  listening: (filter: 'all' | 'liked', limit = 200) =>
    request<import('./types').ListeningPage>(`/api/listening?filter=${filter}&limit=${limit}`),
  cancelDig: () => request<{ affected: number }>('/api/discovery/dig', { method: 'DELETE' }),
  rematch: (suggestion: import('./types').Suggestion, excludeVideoIds: string[]) =>
    request<import('./types').Suggestion>('/api/discovery/rematch', {
      method: 'POST', body: JSON.stringify({ suggestion, exclude_video_ids: excludeVideoIds }),
    }, 180_000),
  recordDiscoveryInteraction: (suggestion: import('./types').Suggestion, action: DiscoveryInteraction) =>
    request<void>('/api/discovery/interactions', {
      method: 'POST', body: JSON.stringify({ suggestion, action }),
    }),
  mpcJobs: () => request<MpcJob[]>('/api/mpc/jobs'),
  enqueueMpc: (suggestion: import('./types').Suggestion, mode: MpcExportMode) =>
    request<MpcJob>('/api/mpc/jobs', {
      method: 'POST', body: JSON.stringify({ suggestion, mode }),
    }, 180_000),
  cancelMpc: (jobId: string) => request<void>(`/api/mpc/jobs/${jobId}`, { method: 'DELETE' }),
  clearFinishedMpc: () => request<{ affected: number }>('/api/mpc/jobs/clear-finished', { method: 'POST' }),
  preview: (videoId: string, mode: 'quick' | 'full' = 'quick') =>
    request<PreviewResponse>(`/api/previews/${videoId}?mode=${mode}`, { method: 'POST' }, mode === 'full' ? 300_000 : 120_000),
  prefetchPreviews: (videoIds: string[]) => request<PreviewPrefetchResponse>('/api/previews/prefetch', {
    method: 'POST', body: JSON.stringify({ video_ids: videoIds }),
  }, 180_000),
  previewStatus: (videoIds: string[]) => request<PreviewPrefetchResponse>(
    `/api/previews/prefetch?video_ids=${encodeURIComponent(videoIds.join(','))}`,
  ),
  trackWaveform: (id: number) => request<{ peaks: number[]; duration_seconds: number }>(`/api/tracks/${id}/waveform`),
  trackLocation: (id: number) => request<TrackLocation>(`/api/tracks/${id}/location`),
  crates: () => request<Crate[]>('/api/crates'),
  crateOverview: () => request<CrateOverview>('/api/crates/overview'),
  crate: (id: number, query = '') => request<CrateDetail>(`/api/crates/${id}?query=${encodeURIComponent(query)}`),
  crateSuggestions: (includeAssigned = false) => request<CrateSuggestion[]>(`/api/crates/suggestions?include_assigned=${includeAssigned}`),
  createCrate: (name: string, description?: string, color = '#F4DF00') =>
    request<Crate>('/api/crates', { method: 'POST', body: JSON.stringify({ name, description, color }) }),
  updateCrate: (id: number, values: { name: string; description: string | null; color: string }) =>
    request<Crate>(`/api/crates/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  assignToCrate: (crateId: number, trackIds: number[], allowMoves = false) =>
    request<CrateAssignmentResult>(`/api/crates/${crateId}/tracks`, { method: 'PUT', body: JSON.stringify({ track_ids: trackIds, allow_moves: allowMoves }) }),
  addToCrate: (crateId: number, trackIds: number[]) =>
    request<CrateAssignmentResult>(`/api/crates/${crateId}/tracks`, { method: 'PUT', body: JSON.stringify({ track_ids: trackIds, allow_moves: false }) }),
  removeFromCrate: (crateId: number, trackIds: number[]) =>
    request<{ removed: number }>(`/api/crates/${crateId}/tracks`, { method: 'DELETE', body: JSON.stringify({ track_ids: trackIds }) }),
  deleteCrate: (crateId: number) => request<void>(`/api/crates/${crateId}`, { method: 'DELETE' }),
  exportTracks: (trackIds: number[], destination: string) =>
    request<{ accepted: number; message: string }>('/api/exports', {
      method: 'POST', body: JSON.stringify({ track_ids: trackIds, destination, chop_kit: false }),
    }),
}

export interface EventStreamHandlers {
  onEvent: (event: QueueEvent) => void
  /** Socket (re)connected: resync anything that may have been missed. */
  onConnected?: () => void
  /** Connection state for status indicators. */
  onStatus?: (connected: boolean) => void
}

const HEARTBEAT_TIMEOUT_MS = 45_000
const MAX_RETRY_MS = 10_000

/**
 * Live event stream with reconnect back-off, heartbeat watchdog and gap
 * detection. The engine address is re-read on every attempt, so a restart
 * on a new port is picked up automatically.
 */
export async function connectEvents(handlers: EventStreamHandlers): Promise<() => void> {
  let socket: WebSocket | undefined
  let closed = false
  let retry: number | undefined
  let watchdog: number | undefined
  let attempts = 0
  let lastSeq: number | null = null

  const scheduleReconnect = () => {
    if (closed) return
    // Exponential back-off with jitter, so restarts are not hammered.
    const base = Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(attempts, 4))
    attempts += 1
    retry = window.setTimeout(() => { void connect() }, base / 2 + Math.random() * base / 2)
  }
  const armWatchdog = () => {
    window.clearTimeout(watchdog)
    // The server pings every 15s; silence means the connection is dead.
    watchdog = window.setTimeout(() => socket?.close(), HEARTBEAT_TIMEOUT_MS)
  }

  const connect = async () => {
    if (closed) return
    let url: URL
    try {
      const runtime = await runtimeConfig()
      url = new URL('/api/events', runtime.baseUrl || window.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('token', runtime.token)
    } catch {
      scheduleReconnect()
      return
    }
    if (closed) return
    const current = new WebSocket(url)
    socket = current
    current.onopen = () => {
      attempts = 0
      lastSeq = null
      armWatchdog()
      handlers.onStatus?.(true)
      handlers.onConnected?.()
    }
    current.onmessage = (message) => {
      armWatchdog()
      let event: QueueEvent & { seq?: number }
      try {
        event = JSON.parse(message.data)
      } catch {
        return
      }
      if (event.type === 'ping') return
      if (typeof event.seq === 'number') {
        // A gap means the server dropped events for a slow client: resync.
        if (lastSeq !== null && event.seq > lastSeq + 1) handlers.onConnected?.()
        lastSeq = event.seq
      }
      handlers.onEvent(event)
    }
    current.onerror = () => current.close()
    current.onclose = () => {
      window.clearTimeout(watchdog)
      if (socket !== current) return
      handlers.onStatus?.(false)
      scheduleReconnect()
    }
  }
  void connect()
  return () => {
    closed = true
    window.clearTimeout(retry)
    window.clearTimeout(watchdog)
    socket?.close()
  }
}
