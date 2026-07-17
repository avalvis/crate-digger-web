import { FormEvent, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Plus, Sparkles } from 'lucide-react'
import { Switch } from 'radix-ui'
import { api } from '../lib/api'
import { useToastStore } from '../store/toast'

export function ManualRip() {
  const [url, setUrl] = useState('')
  const [stems, setStems] = useState(false)
  const [ai, setAi] = useState(true)
  const toast = useToastStore((state) => state.show)
  const queryClient = useQueryClient()
  const queue = useMutation({
    mutationFn: () => api.enqueue({ source_url: url, enable_stems: stems, use_ai_metadata: ai }),
    onSuccess: () => { setUrl(''); toast('Rip added to the queue', 'success'); queryClient.invalidateQueries({ queryKey: ['jobs'] }) },
    onError: (error) => toast(error.message, 'error'),
  })
  const submit = (event: FormEvent) => { event.preventDefault(); if (url) queue.mutate() }
  return (
    <div className="page page--centered">
      <section className="rip-panel">
        <div className="section-kicker"><Link2 size={18} /> INGEST A SOURCE</div>
        <h2>Paste it. Rip it. File it.</h2>
        <p>Crate Digger downloads the cleanest available audio, analyzes tempo and key, embeds metadata, and files it into your local vault.</p>
        <form onSubmit={submit}>
          <label className="url-field"><span>Source URL</span><input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://youtube.com/watch?v=…" /></label>
          <div className="rip-options">
            <label><Switch.Root className="switch" checked={ai} onCheckedChange={setAi}><Switch.Thumb /></Switch.Root><span><strong>AI metadata</strong><small>Recover artist and title from messy uploads</small></span></label>
            <label><Switch.Root className="switch" checked={stems} onCheckedChange={setStems}><Switch.Thumb /></Switch.Root><span><strong>Separate stems</strong><small>Run Demucs after ingestion</small></span></label>
          </div>
          <button className="button button--primary button--large" disabled={queue.isPending}><Plus size={18} /> {queue.isPending ? 'Starting engine…' : 'Queue this track'}</button>
        </form>
        <div className="engine-note"><Sparkles size={16} /><span>The media engine loads only when the first job starts. The interface stays fast even when Demucs is installed.</span></div>
      </section>
    </div>
  )
}

