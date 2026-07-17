import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api, connectEvents } from './lib/api'
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
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: api.jobs, refetchInterval: 15_000 })

  useEffect(() => {
    let disconnect: (() => void) | undefined
    connectEvents((event) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      if (event.type === 'job_completed') queryClient.invalidateQueries({ queryKey: ['tracks'] })
    }).then((value) => { disconnect = value })
    return () => disconnect?.()
  }, [queryClient])

  return (
    <div className="app-shell">
      <Sidebar jobs={jobs.data || []} onQueue={() => setQueueOpen(true)} />
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
      <PlayerBar />
      <QueuePanel open={queueOpen} onOpenChange={setQueueOpen} jobs={jobs.data || []} />
      <Toast />
    </div>
  )
}

