import { Minus, Search, Square, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { windowAction } from '../lib/desktop'

const titles: Record<string, [string, string]> = {
  '/': ['DIGITAL', 'CRATE'],
  '/manual-rip': ['MANUAL', 'RIP'],
  '/vault': ['THE', 'VAULT'],
  '/crates': ['YOUR', 'CRATES'],
  '/settings': ['APP', 'SETTINGS'],
}

export function Topbar({ query, onQuery }: { query: string; onQuery: (value: string) => void }) {
  const location = useLocation()
  const [plain, accent] = location.pathname.startsWith('/crates/') ? ['OPEN', 'CRATE'] : titles[location.pathname] || ['CRATE', 'DIGGER']
  return (
    <header className="topbar" data-tauri-drag-region>
      <h1>{plain} <span>{accent}</span></h1>
      <div className="topbar__spacer" />
      {location.pathname === '/vault' && (
        <label className="top-search">
          <Search size={18} />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search the vault…" />
        </label>
      )}
      <div className="window-controls" aria-label="Window controls">
        <button type="button" aria-label="Minimize" onClick={() => void windowAction('minimize')}><Minus size={17} /></button>
        <button type="button" aria-label="Maximize" onClick={() => void windowAction('maximize')}><Square size={13} /></button>
        <button type="button" aria-label="Close" onClick={() => void windowAction('close')}><X size={17} /></button>
      </div>
    </header>
  )
}
