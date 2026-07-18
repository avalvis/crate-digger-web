import { Disc3, FolderArchive, ListMusic, Radio, Settings, SlidersHorizontal } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { QueueJob, QueueSummary } from '../lib/types'
import { Brand } from './Brand'

const navigation = [
  { to: '/', label: 'Digital Crate', icon: Radio },
  { to: '/manual-rip', label: 'Manual Rip', icon: Disc3 },
  { to: '/vault', label: 'Vault', icon: FolderArchive },
  { to: '/crates', label: 'Crates', icon: ListMusic },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const EMPTY_SUMMARY: QueueSummary = { running: 0, waiting: 0, completed: 0, attention: 0, current_job_id: null }

export function Sidebar({ jobs, summary = EMPTY_SUMMARY, onQueue }: { jobs: QueueJob[]; summary?: QueueSummary; onQueue: () => void }) {
  const active = jobs.find((job) => job.id === summary.current_job_id)
    || jobs.find((job) => !['pending', 'complete', 'complete_with_warnings', 'failed', 'cancelled'].includes(job.status))
  const waiting = summary.waiting
  const hasWork = Boolean(active || waiting)
  const detail = active
    ? `${Math.round(active.progress_pct)}% · ${active.status_message || active.current_stage || 'Preparing'}`
    : waiting
      ? `${waiting} track${waiting === 1 ? '' : 's'} waiting`
      : summary.attention
        ? `${summary.attention} item${summary.attention === 1 ? '' : 's'} need attention`
        : 'Drop in a track and start digging'
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
          <span className={`status-dot ${hasWork ? 'status-dot--active' : summary.attention ? 'status-dot--attention' : ''}`} />
          <strong>{active ? active.display_name || 'QUEUE WORKING' : hasWork ? 'QUEUE WAITING' : summary.attention ? 'QUEUE ATTENTION' : 'QUEUE IDLE'}</strong>
          <small>{detail}</small>
          {(summary.running > 0 || summary.waiting > 0) && <div className="queue-dock__counts">{summary.running} running · {summary.waiting} waiting</div>}
        </div>
      </button>
      <div className="sidebar__version">v0.2.2 WEB</div>
    </aside>
  )
}
