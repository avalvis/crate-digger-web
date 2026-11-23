import { useState } from 'react'
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react'
import { restartBackend, useBackendStore } from '../lib/backend'

/**
 * Covers the app while the audio engine restarts or after it failed, instead
 * of letting every request fail with a raw network error.
 */
export function BackendOverlay() {
  const status = useBackendStore((state) => state.status)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (status.state !== 'restarting' && status.state !== 'failed') return null
  const failed = status.state === 'failed'
  const restart = async () => {
    setRestarting(true)
    setError(null)
    try { await restartBackend() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setRestarting(false) }
  }
  return <div className="backend-overlay" role="alertdialog" aria-modal="true" aria-labelledby="backend-overlay-title">
    <div className="backend-overlay__card">
      {failed ? <AlertTriangle size={28} className="backend-overlay__icon backend-overlay__icon--error" /> : <LoaderCircle size={28} className="backend-overlay__icon spin" />}
      <h2 id="backend-overlay-title">{failed ? 'The audio engine stopped' : 'Reconnecting the audio engine…'}</h2>
      <p>{status.message || (failed ? 'Crate Digger could not restart its engine.' : 'This usually takes a few seconds.')}</p>
      <p className="backend-overlay__note">Your vault and queue are safe; queued tracks resume once the engine is back.</p>
      {failed && <button className="button button--primary" disabled={restarting} onClick={restart}><RotateCcw size={15} />{restarting ? 'Restarting…' : 'Restart engine'}</button>}
      {error && <p className="backend-overlay__error">{error}</p>}
    </div>
  </div>
}

/** Small topbar hint while the live event stream is reconnecting. */
export function ConnectionHint() {
  const { eventsConnected, everConnected, status } = useBackendStore()
  if (eventsConnected || !everConnected || status.state !== 'ready') return null
  return <span className="connection-hint" role="status"><LoaderCircle size={12} className="spin" />Reconnecting…</span>
}
