import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { api, connectEvents, resetRuntime } from './lib/api'
import { useBackendStore, watchBackendStatus } from './lib/backend'
import { BackendOverlay } from './components/BackendOverlay'
import type { QueuePage } from './lib/types'
import { useDigitalCrateStore } from './store/digitalCrate'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { Toast } from './components/Toast'
import { DigitalCrate } from './features/DigitalCrate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToolStatusBanner, toolsNeedAttention, useTools } from './components/ToolStatus'

// The landing page loads eagerly; other pages load on first visit.
const ManualRip = lazy(() => import('./features/ManualRip').then((module) => ({ default: module.ManualRip })))
const Vault = lazy(() => import('./features/Vault').then((module) => ({ default: module.Vault })))
const Crates = lazy(() => import('./features/Crates').then((module) => ({ default: module.Crates })))
const Settings = lazy(() => import('./features/Settings').then((module) => ({ default: module.Settings })))

export default function App() {
  const location = useLocation()
  const [queueOpen, setQueueOpen] = useState(false)
  const [vaultQuery, setVaultQuery] = useState('')
  const queryClient = useQueryClient()
  const eventsConnected = useBackendStore((state) => state.eventsConnected)
  // Live events keep the queue fresh; poll only while the socket is down.
  const jobs = useQuery({ queryKey: ['jobs', 'queue'], queryFn: () => api.jobs({ view: 'queue' }), refetchInterval: eventsConnected ? false : 15_000 })
  const tools = useTools()
  // The search box only exists on the Vault; don't keep a hidden filter.
  useEffect(() => { if (location.pathname !== '/vault') setVaultQuery('') }, [location.pathname])

  useEffect(() => {
    let stopWatching: (() => void) | undefined
    let disposed = false
    // After an engine restart the port changes: drop the cached address and
    // refetch everything once it is reachable again.
    watchBackendStatus(() => {
      resetRuntime()
      queryClient.invalidateQueries()
    }).then((stop) => {
      if (disposed) stop()
      else stopWatching = stop
    }).catch(() => undefined)
    return () => {
      disposed = true
      stopWatching?.()
    }
  }, [queryClient])

  useEffect(() => {
    let disconnect: (() => void) | undefined
    let disposed = false
    connectEvents({ onStatus: useBackendStore.getState().setEventsConnected, onEvent: (event) => {
      if (event.type === 'discovery_progress') {
        useDigitalCrateStore.getState().setDigStatus(event.message || null)
        return
      }
      if (event.type.startsWith('preview_') && event.video_id && event.state) {
        useDigitalCrateStore.getState().updatePreview({
          video_id: event.video_id,
          state: event.state,
          percent: event.percent || 0,
          message: event.message || '',
          error_message: event.error_message || null,
        })
      }
      const eventJob = event.job
      if (event.type.startsWith('mpc_') && eventJob && 'job_id' in eventJob) {
        useDigitalCrateStore.getState().updateMpcJob(eventJob)
      }
      if (eventJob && 'id' in eventJob) {
        queryClient.setQueryData<QueuePage>(['jobs', 'queue'], (page) => {
          if (!page) return page
          const items = page.items.some((job) => job.id === eventJob.id)
            ? page.items.map((job) => job.id === eventJob.id ? eventJob : job)
            : [eventJob, ...page.items]
          return { ...page, items: items.filter((job) => !job.archived_at) }
        })
      }
      // Only queue events change job lists; preview/MPC progress must not
      // trigger a jobs refetch on every tick.
      if (event.type.startsWith('job_') || event.type.startsWith('queue_') || event.type.startsWith('worker_')) {
        queryClient.invalidateQueries({ queryKey: ['jobs'] })
      }
      if (event.type === 'job_completed' || event.type === 'job_completed_with_warnings') queryClient.invalidateQueries({ queryKey: ['tracks'] })
    }, onConnected: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      const ids = useDigitalCrateStore.getState().items.map((item) => item.youtube_video_id).filter((value): value is string => !!value)
      if (ids.length) api.previewStatus(ids).then((result) => useDigitalCrateStore.getState().setPreviewItems(result.items)).catch(() => undefined)
      api.mpcJobs().then((result) => useDigitalCrateStore.getState().setMpcJobs(result)).catch(() => undefined)
    } }).then((value) => {
      if (disposed) value()
      else disconnect = value
    })
    return () => {
      disposed = true
      disconnect?.()
    }
  }, [queryClient])

  return (
    <div className="app-shell">
      <Sidebar jobs={jobs.data?.items || []} summary={jobs.data?.summary} onQueue={() => setQueueOpen(true)} settingsAlert={toolsNeedAttention(tools.data)} />
      <div className="app-main">
        <Topbar query={vaultQuery} onQuery={setVaultQuery} />
        <ToolStatusBanner />
        <main className="content-scroll">
          {/* Keyed by path so a page error clears when you navigate away. */}
          <ErrorBoundary key={location.pathname} area="This page">
          <Suspense fallback={<div className="page page-loading" aria-busy="true" />}>
          <Routes>
            <Route path="/" element={<DigitalCrate />} />
            <Route path="/manual-rip" element={<ManualRip />} />
            <Route path="/vault" element={<Vault query={vaultQuery} />} />
            <Route path="/crates" element={<Crates />} />
            <Route path="/crates/:crateId" element={<Crates />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <PlayerBar onQueue={() => setQueueOpen(true)} />
      <QueuePanel open={queueOpen} onOpenChange={setQueueOpen} queue={jobs.data} />
      <Toast />
      <BackendOverlay />
    </div>
  )
}
