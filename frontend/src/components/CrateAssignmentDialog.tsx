import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from 'radix-ui'
import { Archive, Check, LoaderCircle, Plus, Search, X } from 'lucide-react'
import { api } from '../lib/api'
import type { CrateAssignmentConflict } from '../lib/types'
import { useToastStore } from '../store/toast'

export const CRATE_COLORS = ['#F4DF00', '#9D9A3D', '#D47432', '#B94141', '#397D73', '#3D6F9D', '#72509D', '#A84F78']

interface AssignmentDialogProps {
  open: boolean
  initialTrackIds?: number[]
  targetCrateId?: number
  onOpenChange: (open: boolean) => void
  onComplete?: () => void
}

type ConflictError = Error & { code?: string; detail?: { conflicts?: CrateAssignmentConflict[] } }

export function CrateAssignmentDialog({ open, initialTrackIds = [], targetCrateId, onOpenChange, onComplete }: AssignmentDialogProps) {
  const queryClient = useQueryClient()
  const toast = useToastStore((state) => state.show)
  const [trackIds, setTrackIds] = useState<number[]>(initialTrackIds)
  const [crateId, setCrateId] = useState<number | null>(targetCrateId || null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(CRATE_COLORS[0])
  const [conflicts, setConflicts] = useState<CrateAssignmentConflict[]>([])
  const overview = useQuery({ queryKey: ['crates', 'overview'], queryFn: api.crateOverview, enabled: open })
  const tracks = useQuery({ queryKey: ['tracks', 'assignment-picker'], queryFn: () => api.tracks('', { limit: 500 }), enabled: open })

  useEffect(() => {
    if (!open) return
    setTrackIds(initialTrackIds)
    setCrateId(targetCrateId || null)
    setSearch('')
    setCreating(false)
    setName('')
    setColor(CRATE_COLORS[0])
    setConflicts([])
  }, [open, targetCrateId, initialTrackIds.join(',')])

  const visibleTracks = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return (tracks.data?.items || []).filter((track) => {
      if (targetCrateId && track.crate?.id === targetCrateId) return false
      return !term || `${track.artist} ${track.title} ${track.genre || ''} ${track.crate?.name || ''}`.toLocaleLowerCase().includes(term)
    })
  }, [tracks.data, search, targetCrateId])

  const finish = async (selectedCrateId: number, allowMoves: boolean) => {
    try {
      const result = await api.assignToCrate(selectedCrateId, trackIds, allowMoves)
      setConflicts([])
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tracks'] }),
        queryClient.invalidateQueries({ queryKey: ['track'] }),
        queryClient.invalidateQueries({ queryKey: ['crates'] }),
      ])
      toast(`${result.assigned + result.moved} track${result.assigned + result.moved === 1 ? '' : 's'} organized`, 'success')
      onComplete?.()
      onOpenChange(false)
    } catch (error) {
      const conflict = error as ConflictError
      if (conflict.code === 'crate_assignment_conflict') {
        setConflicts(conflict.detail?.conflicts || [])
        return
      }
      toast(conflict.message, 'error')
    }
  }

  const assign = useMutation<void, Error, boolean>({
    mutationFn: async (allowMoves = false) => {
      let selectedCrateId = targetCrateId || crateId
      if (creating) {
        if (!name.trim()) throw new Error('Give the new crate a name.')
        const created = await api.createCrate(name.trim(), undefined, color)
        selectedCrateId = created.id
        setCrateId(created.id)
        setCreating(false)
      }
      if (!selectedCrateId) throw new Error('Choose a crate first.')
      if (!trackIds.length) throw new Error('Select at least one track.')
      await finish(selectedCrateId, allowMoves)
    },
    onError: (error) => toast(error.message, 'error'),
  })

  const toggleTrack = (trackId: number) => setTrackIds((current) => current.includes(trackId) ? current.filter((id) => id !== trackId) : [...current, trackId])

  return <Dialog.Root open={open} onOpenChange={(value) => !assign.isPending && onOpenChange(value)}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="assignment-dialog">
    <div className="panel-heading"><div><span className="eyebrow">EXCLUSIVE ORGANIZATION</span><Dialog.Title>{targetCrateId ? 'Add songs to crate' : 'Assign to crate'}</Dialog.Title><Dialog.Description>Each Vault song belongs to one crate at a time.</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close"><X size={18} /></Dialog.Close></div>
    {!initialTrackIds.length && <div className="assignment-picker"><label className="assignment-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the Vault" /></label><div className="assignment-track-list">{visibleTracks.map((track) => <label key={track.id} className={trackIds.includes(track.id) ? 'selected' : ''}><input type="checkbox" checked={trackIds.includes(track.id)} onChange={() => toggleTrack(track.id)} /><span><strong>{track.title}</strong><small>{track.artist}{track.crate ? ` · ${track.crate.name}` : ' · Unassigned'}</small></span></label>)}</div></div>}
    <div className="assignment-summary"><Archive size={16} /><strong>{trackIds.length} selected</strong>{!!initialTrackIds.length && <small>Selected from the Vault</small>}</div>
    {!targetCrateId && <div className="assignment-target">
      {!creating ? <><label className="field"><span>Destination crate</span><select value={crateId || ''} onChange={(event) => setCrateId(Number(event.target.value) || null)}><option value="">Choose a crate</option>{overview.data?.items.map((crate) => <option key={crate.id} value={crate.id}>{crate.name} · {crate.track_count} tracks</option>)}</select></label><button className="text-button" onClick={() => setCreating(true)}><Plus size={13} /> Create a new crate</button></> : <div className="new-crate-inline"><label className="field"><span>New crate name</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label><div className="crate-color-row">{CRATE_COLORS.map((value) => <button key={value} className={color === value ? 'active' : ''} style={{ backgroundColor: value }} aria-label={`Use color ${value}`} onClick={() => setColor(value)} />)}<input type="color" value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} aria-label="Custom crate color" /></div><button className="text-button" onClick={() => setCreating(false)}>Use existing crate</button></div>}
    </div>}
    {!!conflicts.length && <div className="assignment-conflict"><strong>{conflicts.length} selected track{conflicts.length === 1 ? '' : 's'} already belong elsewhere</strong><span>{Array.from(new Set(conflicts.map((item) => item.crate_name))).join(', ')}</span><p>Moving them changes only crate membership. No audio files will move.</p></div>}
    <div className="mpc-dialog__footer"><Dialog.Close className="button button--outline">Cancel</Dialog.Close><button className="button button--primary" disabled={assign.isPending || !trackIds.length} onClick={() => assign.mutate(!!conflicts.length)}>{assign.isPending ? <LoaderCircle className="spin" size={14} /> : conflicts.length ? <Check size={14} /> : <Archive size={14} />} {conflicts.length ? `Confirm ${conflicts.length} move${conflicts.length === 1 ? '' : 's'}` : 'Assign tracks'}</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
