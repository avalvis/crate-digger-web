import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Short name of the area, used in the message. */
  area?: string
}

interface State {
  error: Error | null
}

/**
 * Contains a rendering failure to one area so the rest of the app (player,
 * queue, navigation) keeps working. Remount with a new `key` to reset.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return <div className="page"><div className="error-state error-boundary" role="alert">
      <AlertTriangle size={18} />
      <span>{this.props.area ? `${this.props.area} hit a problem` : 'Something went wrong'}: {error.message}</span>
      <button type="button" className="button button--outline" onClick={() => this.setState({ error: null })}><RotateCcw size={14} />Try again</button>
    </div></div>
  }
}
