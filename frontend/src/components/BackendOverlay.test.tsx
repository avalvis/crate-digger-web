import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendOverlay } from './BackendOverlay'
import { useBackendStore } from '../lib/backend'

const restartBackend = vi.hoisted(() => vi.fn())
vi.mock('../lib/backend', async (original) => ({ ...(await original<typeof import('../lib/backend')>()), restartBackend }))

beforeEach(() => {
  restartBackend.mockReset().mockResolvedValue(undefined)
})

describe('engine status overlay', () => {
  it('stays out of the way while the engine is ready', () => {
    useBackendStore.getState().setStatus({ state: 'ready', baseUrl: 'http://127.0.0.1:1', message: null })
    const { container } = render(<BackendOverlay />)
    expect(container).toBeEmptyDOMElement()
  })

  it('explains an automatic restart', () => {
    useBackendStore.getState().setStatus({ state: 'restarting', baseUrl: '', message: 'Restarting (attempt 1 of 3)…' })
    render(<BackendOverlay />)
    expect(screen.getByText('Reconnecting the audio engine…')).toBeInTheDocument()
    expect(screen.getByText('Restarting (attempt 1 of 3)…')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers a manual restart once automatic restarts give up', () => {
    useBackendStore.getState().setStatus({ state: 'failed', baseUrl: '', message: 'Stopped several times.' })
    render(<BackendOverlay />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart engine' }))
    expect(restartBackend).toHaveBeenCalledTimes(1)
  })
})
