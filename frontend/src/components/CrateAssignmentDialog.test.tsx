import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { CrateAssignmentDialog } from './CrateAssignmentDialog'

vi.mock('../lib/api', () => ({ api: {
  crateOverview: vi.fn(), tracks: vi.fn(), assignToCrate: vi.fn(), createCrate: vi.fn(),
} }))

describe('CrateAssignmentDialog', () => {
  it('requires confirmation before moving an exclusively assigned track', async () => {
    vi.mocked(api.crateOverview).mockResolvedValue({ items: [
      { id: 2, name: 'Night', color: '#3D6F9D', description: null, created_at: null, updated_at: null, track_count: 0 },
    ], unassigned_count: 0 })
    vi.mocked(api.tracks).mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0 })
    const conflict = Object.assign(new Error('Already assigned'), {
      code: 'crate_assignment_conflict', detail: { conflicts: [{ track_id: 11, crate_id: 1, crate_name: 'Dusty' }] },
    })
    vi.mocked(api.assignToCrate).mockRejectedValueOnce(conflict).mockResolvedValueOnce({ assigned: 0, moved: 1, unchanged: 0 })
    const onOpenChange = vi.fn()
    render(<QueryClientProvider client={new QueryClient()}><CrateAssignmentDialog open initialTrackIds={[11]} onOpenChange={onOpenChange} /></QueryClientProvider>)

    const destination = await screen.findByRole('combobox', { name: 'Destination crate' })
    await screen.findByRole('option', { name: /Night/ })
    await userEvent.selectOptions(destination, '2')
    await userEvent.click(screen.getByRole('button', { name: 'Assign tracks' }))
    expect(await screen.findByText(/1 selected track already belong elsewhere/)).toBeInTheDocument()
    expect(screen.getByText('Dusty')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm 1 move' }))

    await waitFor(() => expect(api.assignToCrate).toHaveBeenLastCalledWith(2, [11], true))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
