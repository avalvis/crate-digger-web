import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolStatusBanner, ToolStatusPanel, toolsNeedAttention } from './ToolStatus'
import { api } from '../lib/api'

vi.mock('../lib/api', () => ({ api: { tools: vi.fn(), checkTools: vi.fn(), updateTools: vi.fn(), rollbackTools: vi.fn(), config: vi.fn(), patchConfig: vi.fn() } }))
const ready = { state: 'ready', checked_at: null, message: 'Media tool updates are available.', restart_required: false, can_rollback: false,
  tools: [{ id: 'yt-dlp', name: 'YouTube downloader', installed_version: '2026.7.4', latest_version: '2026.8.19', status: 'update_available', update_supported: true, optional: false, detail: 'Update available' }] }
function mount(node = <ToolStatusPanel />) {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear()
  vi.mocked(api.tools).mockResolvedValue(ready as never)
  vi.mocked(api.config).mockResolvedValue({ config: { downloader: { update_channel: 'stable' } } } as never)
})
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
  it('shows an update failure as an error with per-tool detail and allows a retry', async () => {
    vi.mocked(api.tools).mockResolvedValue({...ready, state:'error', message:'Update failed: solver unavailable',
      tools:[{...ready.tools[0], status:'update_failed', detail:'solver unavailable'}]} as never)
    mount()
    expect(await screen.findByText('Update failed: solver unavailable')).toBeInTheDocument()
    expect(screen.getByText('Update failed')).toBeInTheDocument()
    expect(screen.getByText(/current tools were kept/i)).toBeInTheDocument()
    expect(screen.getByRole('button', {name:'Update tools'})).toBeEnabled()
  })
})

describe('update channel', () => {
  it('switches yt-dlp to nightly builds and re-checks for updates', async () => {
    vi.mocked(api.patchConfig).mockResolvedValue({} as never)
    vi.mocked(api.checkTools).mockResolvedValue({ ...ready, state: 'checking' } as never)
    mount()
    const toggle = await screen.findByRole('checkbox', { name: /nightly builds/ })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(api.patchConfig).toHaveBeenCalledWith('downloader', { update_channel: 'nightly' }))
    await waitFor(() => expect(api.checkTools).toHaveBeenCalledTimes(1))
  })
})

describe('tool banner', () => {
  it('stays hidden when updates are merely available, but flags settings', async () => {
    const { container } = mount(<ToolStatusBanner />)
    await waitFor(() => expect(api.tools).toHaveBeenCalled())
    expect(container.querySelector('.tool-banner')).toBeNull()
    expect(toolsNeedAttention(ready as never)).toBe(true)
  })
  it('asks for a restart in one dismissible line', async () => {
    vi.mocked(api.tools).mockResolvedValue({...ready, restart_required:true} as never)
    mount(<ToolStatusBanner />)
    expect(await screen.findByText(/close and reopen Crate Digger/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'Dismiss'}))
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('warns when an essential tool is broken', async () => {
    vi.mocked(api.tools).mockResolvedValue({...ready, tools:[{...ready.tools[0], status:'error'}]} as never)
    mount(<ToolStatusBanner />)
    expect(await screen.findByText(/YouTube downloader needs attention/)).toBeInTheDocument()
  })
})
