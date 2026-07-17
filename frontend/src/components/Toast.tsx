import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { useToastStore } from '../store/toast'

export function Toast() {
  const { message, tone, clear } = useToastStore()
  if (!message) return null
  return (
    <div className={`toast toast--${tone}`} role="status">
      {tone === 'error' ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}
      <span>{message}</span>
      <button onClick={clear} aria-label="Dismiss"><X size={15} /></button>
    </div>
  )
}

