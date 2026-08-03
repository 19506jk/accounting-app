import { beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../test/msw/browser'
import { renderWithProviders } from '../../test/renderWithProviders'
import Contacts from '../Contacts'

import type { ContactDetail, ContactSummary } from '@shared/contracts'

const contact: ContactSummary = {
  id: 7,
  type: 'DONOR',
  contact_class: 'INDIVIDUAL',
  name: 'Ana Donor',
  first_name: 'Ana',
  last_name: 'Donor',
  email: 'ana@example.com',
  phone: null,
  address_line1: '1 Main Street',
  address_line2: null,
  city: 'Toronto',
  province: 'ON',
  postal_code: 'M1M 1M1',
  donor_id: '5-12345',
  is_active: true,
  notes: null,
}

describe('Contacts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loads and saves notes from the contact detail', async () => {
    let savedPayload: Record<string, unknown> | null = null
    const detail: ContactDetail = { ...contact, notes: 'Prefers email updates' }

    worker.use(
      http.get('/api/contacts', () => HttpResponse.json({ contacts: [contact] })),
      http.get('/api/contacts/:id', () => HttpResponse.json({ contact: detail })),
      http.put('/api/contacts/:id', async ({ request }) => {
        savedPayload = await request.json() as Record<string, unknown>
        return HttpResponse.json({
          contact: { ...detail, notes: savedPayload.notes },
        })
      }),
    )

    const screen = await renderWithProviders(<Contacts />)
    await expect.element(screen.getByText('Ana Donor')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const notes = screen.getByLabelText('Notes')
    await expect.element(notes).toHaveValue('Prefers email updates')
    await userEvent.fill(notes, 'Send year-end receipt by mail')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await expect.element(screen.getByText('Contact updated.')).toBeVisible()
    expect(savedPayload).toHaveProperty('notes', 'Send year-end receipt by mail')
  })
})
