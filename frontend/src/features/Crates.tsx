import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, MoreVertical, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useToastStore } from '../store/toast'

export function Crates() {
  const [name, setName] = useState('')
  const queryClient = useQueryClient()
  const toast = useToastStore((state) => state.show)
  const crates = useQuery({ queryKey: ['crates'], queryFn: api.crates })
  const create = useMutation({ mutationFn: () => api.createCrate(name), onSuccess: () => { setName(''); queryClient.invalidateQueries({ queryKey: ['crates'] }); toast('New crate created', 'success') }, onError: (error) => toast(error.message, 'error') })
  const remove = useMutation({ mutationFn: api.deleteCrate, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crates'] }) })
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim()) create.mutate() }
  return <div className="page crates-page"><div className="page-heading"><div><span className="eyebrow">PROJECTS · MOODS · KITS</span><h2>Organize without moving files</h2></div><form className="create-crate" onSubmit={submit}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="New crate name" /><button className="button button--primary"><Plus size={15} /> Create</button></form></div><div className="crate-grid">{crates.data?.map((crate, index) => <article className="crate-card" key={crate.id}><div className={`crate-cover crate-cover--${(index % 4) + 1}`}><Archive size={32} /><span>{crate.track_count}</span></div><div><span className="eyebrow">CRATE {String(index + 1).padStart(2, '0')}</span><h3>{crate.name}</h3><p>{crate.description || 'A fresh crate, ready for a direction.'}</p><small>{crate.track_count} tracks</small></div><button className="icon-button" onClick={() => remove.mutate(crate.id)} aria-label={`Delete ${crate.name}`}><Trash2 size={16} /></button></article>)}</div>{crates.data?.length === 0 && <div className="empty-state"><div><Archive size={30} /></div><h3>No crates yet</h3><p>Create one for a beat tape, a mood, or an MPC kit.</p></div>}</div>
}

