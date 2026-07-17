import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { ManualRip } from './ManualRip'

vi.mock('../lib/api', () => ({ api: { enqueue: vi.fn() } }))

describe('ManualRip formats', () => {
  it('defaults to M4A and carries an explicit MP3 selection into the queue', async () => {
    vi.mocked(api.enqueue).mockResolvedValue({ id: 1 } as never)
    const user = userEvent.setup()
    render(<QueryClientProvider client={new QueryClient()}><ManualRip /></QueryClientProvider>)
    expect(screen.getByRole('radio', { name: /M4A/ })).toBeChecked()
    await user.type(screen.getByRole('textbox', { name: 'Source URL' }), 'https://youtube.com/watch?v=gem')
    await user.click(screen.getByRole('radio', { name: /MP3/ }))
    await user.click(screen.getByRole('button', { name: 'Queue as MP3' }))
    expect(api.enqueue).toHaveBeenCalledWith(expect.objectContaining({ output_format: 'mp3' }))
  })
})
