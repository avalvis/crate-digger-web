import { Disc3, FolderArchive, ListMusic, Radio, Settings, SlidersHorizontal } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { QueueJob } from '../lib/types'
import { Brand } from './Brand'

const navigation = [
  { to: '/', label: 'Digital Crate', icon: Radio },
  { to: '/manual-rip', label: 'Manual Rip', icon: Disc3 },
  { to: '/vault', label: 'Vault', icon: FolderArchive },
  { to: '/crates', label: 'Crates', icon: ListMusic },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ jobs, onQueue }: { jobs: QueueJob[]; onQueue: () => void }) {
  const active = jobs.find((job) => !['complete', 'failed', 'cancelled'].includes(job.status))
  return (
    <aside className="sidebar">
      <div className="sidebar__top"><Brand /></div>
      <nav className="sidebar__nav" aria-label="Primary navigation">
        {navigation.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>
            <Icon size={19} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <button className="queue-dock" type="button" onClick={onQueue}>
        <div className="queue-dock__art"><SlidersHorizontal size={28} /></div>
        <div className="queue-dock__body">
          <span className={`status-dot ${active ? 'status-dot--active' : ''}`} />
          <strong>{active ? 'QUEUE WORKING' : 'QUEUE IDLE'}</strong>
          <small>{active ? `${Math.round(active.progress_pct)}% · ${active.current_stage || 'Preparing'}` : 'Drop in a track and start digging'}</small>
        </div>
      </button>
      <div className="sidebar__version">v0.1.1 WEB</div>
    </aside>
  )
}
