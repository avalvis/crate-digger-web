import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from 'radix-ui'
import { Disc3, FolderOpen, Play, Save, Search, Star, X } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import type { Track } from '../lib/types'
import { usePlayerStore } from '../store/player'
import { useToastStore } from '../store/toast'

function formatTime(seconds: number | null) {
  if (!seconds) return '—'
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function TrackInspector({ track, open, onOpenChange }: { track: Track | null; open: boolean; onOpenChange: (value: boolean) => void }) {
  const [rating, setRating] = useState(0)
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const toast = useToastStore((state) => state.show)
  const setPlayer = usePlayerStore((state) => state.setTrack)
  const queryClient = useQueryClient()
  useEffect(() => { if (track) { setRating(track.rating || 0); setNotes(track.notes || ''); setTags(track.tags.join(', ')) } }, [track])
  const save = useMutation({
    mutationFn: () => api.patchTrack(track!.id, { rating, notes, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) }),
    onSuccess: () => { toast('Track annotations saved', 'success'); queryClient.invalidateQueries({ queryKey: ['tracks'] }) },
    onError: (error) => toast(error.message, 'error'),
  })
  const play = async () => {
    if (!track) return
    setPlayer({ id: `track-${track.id}`, title: track.title, artist: track.artist, subtitle: 'Vault', audioUrl: await mediaUrl(`/api/tracks/${track.id}/audio`) })
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="track-inspector">
        {track && <>
          <div className="panel-heading"><div><span className="eyebrow">TRACK INSPECTOR</span><Dialog.Title>{track.title}</Dialog.Title><Dialog.Description>{track.artist}</Dialog.Description></div><Dialog.Close className="icon-button"><X size={18} /></Dialog.Close></div>
          <div className="inspector-hero"><div className="record-art record-art--3"><span>{track.artist.slice(0, 2).toUpperCase()}</span><i /></div><div><div className="metadata"><span>{track.year || '—'}</span><b>•</b><span>{track.genre || 'Untagged'}</span><b>•</b><span>{track.bpm ? `${Math.round(track.bpm)} BPM` : 'No BPM'}</span><b>•</b><span>{track.camelot_key || 'No key'}</span></div><button className="button button--primary" disabled={!track.file_available} onClick={play}><Play size={15} fill="currentColor" /> Play track</button></div></div>
          <div className="rating-row" aria-label="Rating">{[1, 2, 3, 4, 5].map((value) => <button onClick={() => setRating(value)} key={value}><Star size={21} fill={value <= rating ? 'currentColor' : 'none'} /></button>)}</div>
          <label className="field"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="dusty, drums, project-x" /></label>
          <label className="field"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} placeholder="What caught your ear?" /></label>
          <button className="button button--primary" onClick={() => save.mutate()} disabled={save.isPending}><Save size={15} /> Save changes</button>
        </>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  )
}

export function Vault({ query }: { query: string }) {
  const [selected, setSelected] = useState<Track | null>(null)
  const tracks = useQuery({ queryKey: ['tracks', query], queryFn: () => api.tracks(query) })
  return (
    <div className="page vault-page">
      <div className="page-heading"><div><span className="eyebrow">LOCAL LIBRARY</span><h2>{tracks.data?.total || 0} records in the vault</h2></div><div className="vault-stats"><span><Disc3 size={16} /> {tracks.data?.items.filter((track) => track.stems_separated).length || 0} with stems</span><span><FolderOpen size={16} /> Filesystem indexed</span></div></div>
      {tracks.isLoading && <div className="loading-state"><Disc3 className="spin" /> Reading the vault…</div>}
      {tracks.isError && <div className="error-state">{tracks.error.message}</div>}
      {tracks.data?.items.length === 0 && <div className="empty-state"><div><Search size={30} /></div><h3>{query ? 'No matching records' : 'Your vault is waiting'}</h3><p>{query ? 'Try a broader artist, title, genre, or tag.' : 'Queue a record from Digital Crate or paste a URL in Manual Rip.'}</p></div>}
      {!!tracks.data?.items.length && <div className="vault-table-wrap"><table className="vault-table"><thead><tr><th>Track</th><th>Genre</th><th>Year</th><th>BPM</th><th>Key</th><th>Time</th><th>Rating</th></tr></thead><tbody>{tracks.data.items.map((track) => <tr key={track.id} onDoubleClick={() => setSelected(track)} onClick={() => setSelected(track)}><td><div className="table-track"><div className="table-art">{track.artist[0]}</div><span><strong>{track.title}</strong><small>{track.artist}</small></span></div></td><td>{track.genre || '—'}</td><td>{track.year || '—'}</td><td>{track.bpm ? Math.round(track.bpm) : '—'}</td><td><span className="key-pill">{track.camelot_key || '—'}</span></td><td>{formatTime(track.duration_seconds)}</td><td><span className="table-rating"><Star size={13} fill="currentColor" /> {track.rating || 0}</span></td></tr>)}</tbody></table></div>}
      <TrackInspector track={selected} open={!!selected} onOpenChange={(value) => !value && setSelected(null)} />
    </div>
  )
}

