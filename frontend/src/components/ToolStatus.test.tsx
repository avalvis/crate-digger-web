import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolStatusPanel } from './ToolStatus'
import { api } from '../lib/api'

vi.mock('../lib/api', () => ({ api: { tools: vi.fn(), checkTools: vi.fn(), updateTools: vi.fn(), rollbackTools: vi.fn() } }))
const ready = { state: 'ready', checked_at: null, message: 'Media tool updates are available.', restart_required: false, can_rollback: false,
  tools: [{ id: 'yt-dlp', name: 'YouTube downloader', installed_version: '2026.7.4', latest_version: '2026.8.19', status: 'update_available', update_supported: true, optional: false, detail: 'Update available' }] }
function mount() {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ToolStatusPanel /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.tools).mockResolvedValue(ready as never) })
describe('media tool updates', () => {
  it('checks status without automatically installing and shows available versions', async () => {
    mount()
    expect(await screen.findByText('2026.8.19')).toBeInTheDocument()
    expect(api.updateTools).not.toHaveBeenCalled()
    expect(screen.getByRole('button', {name:'Update tools'})).toBeEnabled()
  })
  it('installs on request and explains that activation needs a restart', async () => {
    vi.mocked(api.updateTools).mockResolvedValue({...ready, restart_required:true, can_rollback:true, message:'Tools verified.'} as never)
    mount()
    await waitFor(() => expect(screen.getByRole('button', {name:'Update tools'})).toBeEnabled())
    fireEvent.click(screen.getByRole('button', {name:'Update tools'}))
    await waitFor(() => expect(api.updateTools).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Finish what you’re doing/)).toBeInTheDocument()
    expect(screen.getByRole('button', {name:'Update tools'})).toBeDisabled()
    expect(screen.getByRole('button', {name:'Restore previous tools'})).toBeEnabled()
  })
  it('does not claim everything is current when release checks are offline', async () => {
    vi.mocked(api.tools).mockResolvedValue({...ready, message:'Some release checks could not connect.', tools:[{...ready.tools[0],status:'ready',latest_version:null,latest_unavailable:true}]} as never)
    mount()
    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', {name:'Update tools'})).toBeDisabled()
  })
})
