import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, Download, RefreshCw, Wrench } from 'lucide-react'
import { api } from '../lib/api'
import type { MediaTool, ToolStatus } from '../lib/types'

function useTools() {
  return useQuery({
    queryKey: ['media-tools'], queryFn: api.tools,
    refetchInterval: (query) => ['idle', 'checking', 'updating'].includes(query.state.data?.state || '') ? 1500 : 30_000,
  })
}

function needsUpdate(tool: MediaTool) {
  return tool.update_supported && ['missing', 'error', 'update_available'].includes(tool.status)
}

export function ToolStatusBanner() {
  const { data } = useTools()
  if (!data || (data.state !== 'error' && !data.restart_required && !data.tools.some(needsUpdate))) return null
  return <div className="tool-banner" role="status"><Wrench size={14} /><span>{data.message}</span><Link to="/settings">Review tools</Link></div>
}

function ToolRows({ tools }: { tools: MediaTool[] }) {
  return <div className="tool-table"><div className="tool-table__head"><span>Tool</span><span>Installed</span><span>Latest stable</span><span>Status</span></div>{tools.map(tool =>
    <div className="tool-table__row" key={tool.id}>
      <div><strong>{tool.name}</strong><small>{tool.id}{tool.optional ? ' · optional' : ''}</small></div>
      <span>{tool.installed_version || 'Missing'}</span>
      <span>{tool.latest_version || (tool.latest_unavailable ? 'Unavailable' : 'Checking…')}</span>
      <div><span className={`tool-state tool-state--${tool.status}`}>{tool.status === 'update_available' ? (tool.update_supported ? 'Update available' : 'With app update') : tool.status === 'ready' ? 'Ready' : 'Needs attention'}</span><small>{tool.detail}</small></div>
    </div>)}</div>
}

export function ToolStatusPanel() {
  const status = useTools()
  const client = useQueryClient()
  const action = useMutation({
    mutationFn: (kind: 'check' | 'update' | 'rollback') => kind === 'check' ? api.checkTools() : kind === 'update' ? api.updateTools() : api.rollbackTools(),
    onSuccess: (data: ToolStatus) => client.setQueryData(['media-tools'], data),
  })
  const data = status.data
  const busy = action.isPending || ['idle', 'checking', 'updating'].includes(data?.state || '')
  const updates = data?.tools.filter(needsUpdate) || []
  return <section className="settings-card tool-settings" aria-labelledby="tool-heading">
    <div className="settings-card__title"><Wrench /><div><h3 id="tool-heading">Media tools & updates</h3><p>Checked in the background every time you open Crate Digger. Updates install only when you choose.</p></div></div>
    <div className="tool-summary" role="status">{busy ? <RefreshCw size={16} className="tool-spin" /> : <CheckCircle2 size={16} />}<span>{data?.message || (status.isError ? 'Could not load tool status.' : 'Checking media tools…')}</span></div>
    {(action.error || status.error) && <div className="error-state">{(action.error || status.error)?.message}</div>}
    <div className="tool-actions">
      <button className="button button--outline" disabled={busy || data?.restart_required} onClick={() => action.mutate('check')}><RefreshCw size={14} />Check again</button>
      <button className="button button--primary" disabled={busy || !updates.length || data?.restart_required} onClick={() => action.mutate('update')}><Download size={14} />{data?.state === 'updating' ? 'Updating tools…' : 'Update tools'}</button>
      {data?.can_rollback && <button className="button button--outline" disabled={busy} onClick={() => action.mutate('rollback')}>Restore previous tools</button>}
      {data?.checked_at && <small>Last checked {new Date(data.checked_at).toLocaleString()}</small>}
    </div>
    {data?.restart_required && <p className="tool-restart">Update ready. Finish what you’re doing, then close and reopen Crate Digger.</p>}
    <ToolRows tools={data?.tools.filter(tool => tool.update_supported) || []} />
    <p className="tool-note">FFmpeg uses stable releases; the JavaScript runtime uses the latest LTS release. Updates are verified before use and activate on the next launch.</p>
    <details className="tool-libraries"><summary>Audio & stem libraries included with the app</summary><p>These libraries work together as a tested set. Newer releases are listed here; incompatible library changes require an application update.</p><ToolRows tools={data?.tools.filter(tool => !tool.update_supported) || []} /></details>
  </section>
}
