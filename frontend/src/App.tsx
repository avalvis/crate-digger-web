import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api, connectEvents } from './lib/api'
import type { QueuePage } from './lib/types'
import { useDigitalCrateStore } from './store/digitalCrate'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { Toast } from './components/Toast'
import { DigitalCrate } from './features/DigitalCrate'
import { ManualRip } from './features/ManualRip'
import { Vault } from './features/Vault'
import { Crates } from './features/Crates'
import { Settings } from './features/Settings'

export default function App() {
  const [queueOpen, setQueueOpen] = useState(false)
  const [vaultQuery, setVaultQuery] = useState('')
  const queryClient = useQueryClient()
  const jobs = useQuery({ queryKey: ['jobs', 'queue'], queryFn: () => api.jobs({ view: 'queue' }), refetchInterval: 15_000 })

  useEffect(() => {
    let disconnect: (() => void) | undefined
    let disposed = false
    connectEvents((event) => {
      if (event.type.startsWith('preview_') && event.video_id && event.state) {
        useDigitalCrateStore.getState().updatePreview({
          video_id: event.video_id,
          state: event.state,
          percent: event.percent || 0,
          message: event.message || '',
          error_message: event.error_message || null,
        })
      }
      if (event.job) {
        queryClient.setQueryData<QueuePage>(['jobs', 'queue'], (page) => {
          if (!page) return page
          const items = page.items.some((job) => job.id === event.job!.id)
            ? page.items.map((job) => job.id === event.job!.id ? event.job! : job)
            : [event.job!, ...page.items]
          return { ...page, items: items.filter((job) => !job.archived_at) }
        })
      }
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      if (event.type === 'job_completed' || event.type === 'job_completed_with_warnings') queryClient.invalidateQueries({ queryKey: ['tracks'] })
    }, () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      const ids = useDigitalCrateStore.getState().items.map((item) => item.youtube_video_id).filter((value): value is string => !!value)
      if (ids.length) api.previewStatus(ids).then((result) => useDigitalCrateStore.getState().setPreviewItems(result.items)).catch(() => undefined)
    }).then((value) => {
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
      <Sidebar jobs={jobs.data?.items || []} summary={jobs.data?.summary} onQueue={() => setQueueOpen(true)} />
      <div className="app-main">
        <Topbar query={vaultQuery} onQuery={setVaultQuery} />
        <main className="content-scroll">
          <Routes>
            <Route path="/" element={<DigitalCrate />} />
            <Route path="/manual-rip" element={<ManualRip />} />
            <Route path="/vault" element={<Vault query={vaultQuery} />} />
            <Route path="/crates" element={<Crates />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <PlayerBar onQueue={() => setQueueOpen(true)} />
      <QueuePanel open={queueOpen} onOpenChange={setQueueOpen} queue={jobs.data} />
      <Toast />
    </div>
  )
}
