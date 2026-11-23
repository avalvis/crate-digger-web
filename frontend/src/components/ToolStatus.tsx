import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Wrench, X } from 'lucide-react'
import { api } from '../lib/api'
import type { MediaTool, ToolStatus } from '../lib/types'

const BUSY_STATES = ['idle', 'checking', 'updating']
const DISMISS_KEY = 'cratedigger.toolBannerDismissed'

export function useTools() {
  return useQuery({
    queryKey: ['media-tools'], queryFn: api.tools,
    // Poll only while the backend is working; otherwise the status is stable.
    refetchInterval: (query) => BUSY_STATES.includes(query.state.data?.state || '') ? 1500 : 5 * 60_000,
  })
}

function needsUpdate(tool: MediaTool) {
  return tool.update_supported && ['missing', 'error', 'update_available', 'update_failed'].includes(tool.status)
}

function isBroken(tool: MediaTool) {
  return !tool.optional && ['missing', 'error'].includes(tool.status)
}

/** Something in Settings deserves a look (used for the sidebar dot). */
export function toolsNeedAttention(data: ToolStatus | undefined) {
  return Boolean(data && (data.restart_required || data.state === 'error' || data.tools.some(needsUpdate)))
}

function bannerMessage(data: ToolStatus | undefined) {
  if (!data) return null
  if (data.restart_required) return 'Updated media tools are ready. Close and reopen Crate Digger to use them.'
  const broken = data.tools.filter(isBroken)
  if (broken.length) return `${broken.map((tool) => tool.name).join(', ')} ${broken.length === 1 ? 'needs' : 'need'} attention. Downloads may not work.`
  return null
}

function readDismissed() {
  try { return sessionStorage.getItem(DISMISS_KEY) } catch { return null }
}

export function ToolStatusBanner() {
  const { data } = useTools()
  const message = bannerMessage(data)
  const [dismissed, setDismissed] = useState(readDismissed)
  if (!message || dismissed === message) return null
  const dismiss = () => {
    setDismissed(message)
    try { sessionStorage.setItem(DISMISS_KEY, message) } catch { /* storage unavailable */ }
  }
  return <div className="tool-banner" role="status">
    <Wrench size={14} /><span>{message}</span>
    <Link to="/settings">Review tools</Link>
    <button type="button" className="tool-banner__close" aria-label="Dismiss" onClick={dismiss}><X size={14} /></button>
  </div>
}

function stateLabel(tool: MediaTool) {
  switch (tool.status) {
    case 'update_available': return tool.update_supported ? 'Update available' : 'With app update'
    case 'update_failed': return 'Update failed'
    case 'ready': return 'Ready'
    default: return 'Needs attention'
  }
}

function ToolRows({ tools }: { tools: MediaTool[] }) {
  return <div className="tool-table"><div className="tool-table__head"><span>Tool</span><span>Installed</span><span>Latest stable</span><span>Status</span></div>{tools.map(tool => {
    const label = stateLabel(tool)
    return <div className="tool-table__row" key={tool.id}>
      <div><strong>{tool.name}</strong><small>{tool.id}{tool.optional ? ' · optional' : ''}</small></div>
      <span>{tool.installed_version || 'Missing'}</span>
      <span>{tool.latest_version || (tool.latest_unavailable ? 'Unavailable' : 'Checking…')}</span>
      <div><span className={`tool-state tool-state--${tool.status}`}>{label}</span>{tool.detail && tool.detail !== label && <small>{tool.detail}</small>}</div>
    </div>
  })}</div>
}

export function ToolStatusPanel() {
  const status = useTools()
  const client = useQueryClient()
  const action = useMutation({
    mutationFn: (kind: 'check' | 'update' | 'rollback') => kind === 'check' ? api.checkTools() : kind === 'update' ? api.updateTools() : api.rollbackTools(),
    onSuccess: (data: ToolStatus) => client.setQueryData(['media-tools'], data),
  })
  const config = useQuery({ queryKey: ['config'], queryFn: api.config })
  const nightly = (config.data?.config.downloader as { update_channel?: string } | undefined)?.update_channel === 'nightly'
  const channel = useMutation({
    // Switching channel changes which yt-dlp is "latest", so re-check at once.
    mutationFn: async (value: 'stable' | 'nightly') => {
      await api.patchConfig('downloader', { update_channel: value })
      return api.checkTools()
    },
    onSuccess: (data: ToolStatus) => {
      client.setQueryData(['media-tools'], data)
      client.invalidateQueries({ queryKey: ['config'] })
    },
  })
  const data = status.data
  const busy = action.isPending || channel.isPending || BUSY_STATES.includes(data?.state || '')
  const failed = data?.state === 'error' || status.isError
  const updates = data?.tools.filter(needsUpdate) || []
  const SummaryIcon = busy ? RefreshCw : failed ? AlertTriangle : CheckCircle2
  return <section className="settings-card tool-settings" aria-labelledby="tool-heading">
    <div className="settings-card__title"><Wrench /><div><h3 id="tool-heading">Media tools & updates</h3><p>Checked in the background every time you open Crate Digger. Updates install only when you choose.</p></div></div>
    <div className={`tool-summary${failed ? ' tool-summary--error' : ''}`} role="status">
      <SummaryIcon size={16} className={busy ? 'tool-spin' : undefined} />
      <span>{data?.message || (status.isError ? 'Could not load tool status.' : 'Checking media tools…')}</span>
    </div>
    {failed && !busy && <p className="tool-help">Your current tools were kept and still work. Try again later, or install the next app release if this keeps happening.</p>}
    {(action.error || channel.error) && <div className="error-state">{(action.error || channel.error)?.message}</div>}
    <div className="tool-actions">
      <button className="button button--outline" disabled={busy || data?.restart_required} onClick={() => action.mutate('check')}><RefreshCw size={14} />Check again</button>
      <button className="button button--primary" disabled={busy || !updates.length || data?.restart_required} onClick={() => action.mutate('update')}><Download size={14} />{data?.state === 'updating' ? 'Updating tools…' : 'Update tools'}</button>
      {data?.can_rollback && <button className="button button--outline" disabled={busy} onClick={() => action.mutate('rollback')}>Restore previous tools</button>}
      {data?.checked_at && <small>Last checked {new Date(data.checked_at).toLocaleString()}</small>}
    </div>
    {data?.restart_required && <p className="tool-restart">Update ready. Finish what you’re doing, then close and reopen Crate Digger.</p>}
    <label className="tool-channel">
      <input type="checkbox" checked={nightly} disabled={!config.data || busy || data?.restart_required} onChange={(event) => channel.mutate(event.target.checked ? 'nightly' : 'stable')} />
      <span><strong>Use yt-dlp nightly builds</strong><small>Gets YouTube fixes days before a stable release. Slightly less tested; switch back any time.</small></span>
    </label>
    <ToolRows tools={data?.tools.filter(tool => tool.update_supported) || []} />
    <p className="tool-note">FFmpeg uses stable releases; the JavaScript runtime uses the latest LTS release. Updates are verified before use and activate on the next launch.</p>
    <details className="tool-libraries"><summary>Audio & stem libraries included with the app</summary><p>These libraries work together as a tested set. Newer releases are listed here; incompatible library changes require an application update.</p><ToolRows tools={data?.tools.filter(tool => !tool.update_supported) || []} /></details>
  </section>
}
