import { create } from 'zustand'

/** Engine lifecycle as reported by the desktop shell's sidecar supervisor. */
export type BackendState = 'starting' | 'ready' | 'restarting' | 'failed'

export interface BackendStatus {
  state: BackendState
  baseUrl: string
  message: string | null
}

interface BackendStore {
  status: BackendStatus
  /** Live event socket state; false while reconnecting. */
  eventsConnected: boolean
  /** True once the socket has connected at least once this session. */
  everConnected: boolean
  setStatus: (status: BackendStatus) => void
  setEventsConnected: (connected: boolean) => void
}

export const useBackendStore = create<BackendStore>((set) => ({
  status: { state: 'starting', baseUrl: '', message: null },
  eventsConnected: false,
  everConnected: false,
  setStatus: (status) => set({ status }),
  setEventsConnected: (connected) => set((state) => ({ eventsConnected: connected, everConnected: state.everConnected || connected })),
}))

/**
 * Follow the shell's `backend-status` events. `onReady` runs whenever the
 * engine becomes reachable again on a (possibly new) port.
 */
export async function watchBackendStatus(onReady: () => void): Promise<() => void> {
  if (!window.__TAURI_INTERNALS__) {
    useBackendStore.getState().setStatus({ state: 'ready', baseUrl: '', message: null })
    return () => undefined
  }
  const { invoke } = await import('@tauri-apps/api/core')
  const { listen } = await import('@tauri-apps/api/event')
  let previous: BackendState | null = null
  const apply = (status: BackendStatus) => {
    useBackendStore.getState().setStatus(status)
    if (status.state === 'ready' && previous !== null && previous !== 'ready') onReady()
    previous = status.state
  }
  const unlisten = await listen<BackendStatus>('backend-status', (event) => apply(event.payload))
  apply(await invoke<BackendStatus>('backend_status'))
  return unlisten
}

export async function restartBackend() {
  if (!window.__TAURI_INTERNALS__) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('restart_backend')
}
