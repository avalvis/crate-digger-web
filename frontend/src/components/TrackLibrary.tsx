import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from 'radix-ui'
import { Archive, Disc3, FolderSearch, ImageOff, Play, Save, Star, X } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { revealFile } from '../lib/desktop'
import type { Track } from '../lib/types'
import { usePlayerStore } from '../store/player'
import { useToastStore } from '../store/toast'
import { CrateAssignmentDialog } from './CrateAssignmentDialog'

export function formatTrackTime(seconds: number | null) {
  return seconds ? `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}` : '—'
}

export function TrackArtwork({ track, className = '' }: { track: Track; className?: string }) {
  const artwork = useQuery({
    queryKey: ['track-artwork-url', track.id, track.artwork_url],
    queryFn: () => track.artwork_url ? mediaUrl(track.artwork_url) : Promise.resolve(null),
    staleTime: Infinity,
  })
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [track.id, artwork.data])
  if (!artwork.data || failed) return <div className={className}><span>{track.artist.slice(0, 2).toUpperCase()}</span>{failed && <ImageOff size={10} />}</div>
  return <div className={className}><img src={artwork.data} alt={`${track.artist} — ${track.title} cover`} onError={() => setFailed(true)} /></div>
}

export async function revealTrack(trackId: number) {
  const location = await api.trackLocation(trackId)
  if (!location.available) throw new Error('The audio file is missing or its drive is disconnected.')
  await revealFile(location.file_path)
}

export function TrackTable({ tracks, selected, onSelected, onOpen, showCrate = true }: {
  tracks: Track[]; selected: number[]; onSelected: (ids: number[]) => void
  onOpen: (id: number) => void; showCrate?: boolean
}) {
  const toast = useToastStore((state) => state.show)
  const allSelected = !!tracks.length && tracks.every((track) => selected.includes(track.id))
  const toggle = (id: number) => onSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id])
  const reveal = async (trackId: number) => {
    try { await revealTrack(trackId) } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
  }
  return <div className="vault-table-wrap"><table className="vault-table"><thead><tr><th className="check-cell"><input aria-label="Select all tracks" type="checkbox" checked={allSelected} onChange={() => onSelected(allSelected ? [] : tracks.map((track) => track.id))} /></th><th>Track</th>{showCrate && <th>Crate</th>}<th>Genre</th><th>Year</th><th>BPM</th><th>Key</th><th>Time</th><th>Local</th></tr></thead><tbody>{tracks.map((track) => <tr key={track.id} className={selected.includes(track.id) ? 'is-selected' : ''} onDoubleClick={() => onOpen(track.id)} onClick={() => onOpen(track.id)}><td className="check-cell" onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${track.artist} — ${track.title}`} type="checkbox" checked={selected.includes(track.id)} onChange={() => toggle(track.id)} /></td><td><div className="table-track"><TrackArtwork track={track} className="table-art" /><span><strong>{track.title}</strong><small>{track.artist}</small></span></div></td>{showCrate && <td>{track.crate ? <span className="crate-badge" style={{ '--crate-color': track.crate.color } as React.CSSProperties}><i />{track.crate.name}</span> : <span className="unassigned-badge">Unassigned</span>}</td>}<td>{track.genre || '—'}</td><td>{track.year || '—'}</td><td>{track.bpm ? Math.round(track.bpm) : '—'}</td><td><span className="key-pill">{track.camelot_key || '—'}</span></td><td>{formatTrackTime(track.duration_seconds)}</td><td onClick={(event) => event.stopPropagation()}><button className="icon-button reveal-track" title="Reveal audio file" aria-label={`Reveal ${track.artist} — ${track.title}`} onClick={() => reveal(track.id)}><FolderSearch size={15} /></button></td></tr>)}</tbody></table></div>
}

export function TrackInspector({ trackId, open, onOpenChange }: { trackId: number | null; open: boolean; onOpenChange: (value: boolean) => void }) {
  const [rating, setRating] = useState(0); const [notes, setNotes] = useState(''); const [tags, setTags] = useState(''); const [assigning, setAssigning] = useState(false)
  const toast = useToastStore((state) => state.show); const player = usePlayerStore(); const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: ['track', trackId], queryFn: () => api.track(trackId!), enabled: trackId !== null && open })
  const track = detail.data || null
  useEffect(() => { if (track) { setRating(track.rating || 0); setNotes(track.notes || ''); setTags(track.tags.join(', ')) } }, [track])
  const save = useMutation({ mutationFn: () => api.patchTrack(track!.id, { rating, notes, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) }), onSuccess: (updated) => { queryClient.setQueryData(['track', updated.id], updated); toast('Track annotations saved', 'success'); queryClient.invalidateQueries({ queryKey: ['tracks'] }) }, onError: (error) => toast(error.message, 'error') })
  const remove = useMutation({ mutationFn: () => api.removeFromCrate(track!.crate!.id, [track!.id]), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['track'] }); queryClient.invalidateQueries({ queryKey: ['tracks'] }); queryClient.invalidateQueries({ queryKey: ['crates'] }); toast('Track is now unassigned', 'success') }, onError: (error) => toast(error.message, 'error') })
  const play = async () => {
    if (!track) return
    const [audioUrl, artworkUrl, waveform] = await Promise.all([mediaUrl(`/api/tracks/${track.id}/audio`), track.artwork_url ? mediaUrl(track.artwork_url).catch(() => null) : Promise.resolve(null), api.trackWaveform(track.id).catch(() => ({ peaks: [] as number[], duration_seconds: track.duration_seconds || 0 }))])
    player.setTrack({ id: `track-${track.id}`, title: track.title, artist: track.artist, subtitle: `Vault · ${track.output_format.toUpperCase()}`, audioUrl, artworkUrl, peaks: waveform.peaks })
  }
  const reveal = async () => { if (track) try { await revealTrack(track.id) } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') } }
  const playing = player.track?.id === `track-${track?.id}` && player.playing
  return <><Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="track-inspector">{detail.isLoading && <div className="loading-state"><Disc3 className="spin" /> Loading track details…</div>}{detail.isError && <div className="error-state">{detail.error.message}</div>}{track && <>
    <div className="panel-heading"><div><span className="eyebrow">TRACK INSPECTOR</span><Dialog.Title>{track.title}</Dialog.Title><Dialog.Description>{track.artist}</Dialog.Description></div><Dialog.Close className="icon-button"><X size={18} /></Dialog.Close></div>
    <div className="inspector-hero"><TrackArtwork track={track} className={`record-art inspector-art vinyl-art ${playing ? 'is-playing' : ''}`} /><div><div className="metadata"><span>{track.year || '—'}</span><b>•</b><span>{track.genre || 'Untagged'}</span><b>•</b><span>{track.bpm ? `${Math.round(track.bpm)} BPM` : 'No BPM'}</span><b>•</b><span>{track.camelot_key || 'No key'}</span><b>•</b><span>{track.output_format.toUpperCase()}</span></div><div className="inspector-actions"><button className="button button--primary" disabled={!track.file_available} onClick={play}><Play size={15} fill="currentColor" /> Play track</button><button className="button button--outline" onClick={reveal}><FolderSearch size={14} /> Reveal file</button></div></div></div>
    <div className="inspector-crate"><div><Archive size={15} /><span><strong>{track.crate?.name || 'Unassigned'}</strong><small>Exclusive crate membership</small></span></div><div><button className="button button--outline" onClick={() => setAssigning(true)}>{track.crate ? 'Move' : 'Assign'}</button>{track.crate && <button className="text-button" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</button>}</div></div>
    <div className="rating-row" aria-label="Rating">{[1, 2, 3, 4, 5].map((value) => <button onClick={() => setRating(value)} key={value}><Star size={21} fill={value <= rating ? 'currentColor' : 'none'} /></button>)}</div>
    <label className="field"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="dusty, drums, project-x" /></label><label className="field"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} placeholder="What caught your ear?" /></label><button className="button button--primary" onClick={() => save.mutate()} disabled={save.isPending}><Save size={15} /> Save changes</button>
  </>}</Dialog.Content></Dialog.Portal></Dialog.Root><CrateAssignmentDialog open={assigning} initialTrackIds={track ? [track.id] : []} onOpenChange={setAssigning} /></>
}
