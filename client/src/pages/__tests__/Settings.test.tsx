import { beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../test/msw/browser'
import { renderWithProviders } from '../../test/renderWithProviders'
import Settings from '../Settings'

import type { AuthUser } from '@shared/contracts'

const admin: AuthUser = {
  id: 1,
  name: 'Admin',
  email: 'admin@example.com',
  avatar_url: null,
  role: 'admin',
}

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`
const LEGACY_URL = 'https://old.example.com/signature.png'

function pngBytes(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0))
}

type SettingsState = Record<string, string | null>

let lastPut: SettingsState | null = null

function seedSettings(values: SettingsState = {}) {
  worker.use(
    http.get('/api/settings', () => HttpResponse.json({ settings: [], values })),
    http.put('/api/settings', async ({ request }) => {
      lastPut = (await request.json()) as SettingsState
      return HttpResponse.json({ settings: [], values: lastPut })
    }),
  )
}

describe('Settings signer sections', () => {
  beforeEach(async () => {
    lastPut = null
    await page.viewport(1280, 900)
  })

  it('renders both signer sections with name inputs and upload controls', async () => {
    seedSettings()
    const screen = await renderWithProviders(<Settings />, { auth: admin })

    await expect.element(screen.getByRole('heading', { name: 'Branch Accountant' })).toBeVisible()
    await expect.element(screen.getByRole('heading', { name: 'Treasurer' })).toBeVisible()
    await expect.element(screen.getByLabelText('Branch Accountant Name')).toBeVisible()
    await expect.element(screen.getByLabelText('Treasurer Name')).toBeVisible()
    // File inputs are visually hidden but present and reachable by label.
    await expect.element(screen.getByLabelText('Upload Branch Accountant signature')).toHaveAttribute('type', 'file')
    await expect.element(screen.getByLabelText('Upload Treasurer signature')).toHaveAttribute('type', 'file')
  })

  it('uploads a PNG signature and submits it in the settings payload', async () => {
    seedSettings()
    const screen = await renderWithProviders(<Settings />, { auth: admin })

    await screen.getByLabelText('Upload Branch Accountant signature').upload(
      new File([pngBytes()], 'signature.png', { type: 'image/png' }),
    )

    const preview = screen.getByAltText('Branch Accountant signature preview')
    await expect.element(preview).toHaveAttribute('src', PNG_DATA_URI)

    await screen.getByText('Save Settings').click()
    await expect.poll(() => lastPut?.church_signature_url).toBe(PNG_DATA_URI)
  })

  it('keeps a rejected signature upload out of the save payload while other edits save', async () => {
    seedSettings({ branch_accountant_name: 'Jane Accountant' })
    const screen = await renderWithProviders(<Settings />, { auth: admin })

    await screen.getByLabelText('Upload Branch Accountant signature').upload(
      new File([new Uint8Array(250 * 1024 + 1)], 'big.png', { type: 'image/png' }),
    )

    await expect.element(
      screen.getByText('Branch Accountant signature must be 250 KB or smaller.'),
    ).toBeVisible()
    await screen.getByLabelText('Treasurer Name').fill('Tom Treasurer')
    await screen.getByText('Save Settings').click()

    // The rejected file never enters the form, so the save omits the
    // signature key (server keeps the previous value) while the rest saves.
    await expect.poll(() => lastPut?.branch_accountant_name).toBe('Jane Accountant')
    await expect.poll(() => lastPut?.treasurer_name).toBe('Tom Treasurer')
    expect(lastPut).not.toHaveProperty('church_signature_url')
  })

  it('edits signer names and submits them', async () => {
    seedSettings()
    const screen = await renderWithProviders(<Settings />, { auth: admin })

    await screen.getByLabelText('Branch Accountant Name').fill('Jane Accountant')
    await screen.getByLabelText('Treasurer Name').fill('Tom Treasurer')
    await screen.getByText('Save Settings').click()

    await expect.poll(() => lastPut?.branch_accountant_name).toBe('Jane Accountant')
    await expect.poll(() => lastPut?.treasurer_name).toBe('Tom Treasurer')
  })

  it('replaces a configured signature via the Replace button', async () => {
    seedSettings({ church_signature_url: PNG_DATA_URI })
    const screen = await renderWithProviders(<Settings />, { auth: admin })

    await expect.element(screen.getByAltText('Branch Accountant signature preview')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Replace' })).toBeVisible()

    await screen.getByLabelText('Upload Branch Accountant signature').upload(
      new File([pngBytes()], 'new.png', { type: 'image/png' }),
    )
    await screen.getByText('Save Settings').click()
    await expect.poll(() => lastPut?.church_signature_url).toBe(PNG_DATA_URI)
  })

  it('removes a configured signature and submits null', async () => {
    seedSettings({ church_signature_url: PNG_DATA_URI, treasurer_signature_url: PNG_DATA_URI })
    const screen = await renderWithProviders(<Settings />, { auth: admin })

    // The first Remove button belongs to the Branch Accountant section.
    await screen.getByRole('button', { name: 'Remove' }).first().click()
    await screen.getByText('Save Settings').click()

    await expect.poll(() => lastPut?.church_signature_url).toBeNull()
    await expect.poll(() => lastPut?.treasurer_signature_url).toBe(PNG_DATA_URI)
  })

  it('normalizes a legacy URL as unconfigured until replaced or removed', async () => {
    seedSettings({ church_signature_url: LEGACY_URL })
    const screen = await renderWithProviders(<Settings />, { auth: admin })

    await expect.element(screen.getByText(/legacy image URL is stored/)).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Replace' })).toBeVisible()

    // Removing the legacy value submits null rather than the remote URL.
    await screen.getByRole('button', { name: 'Remove' }).click()
    await screen.getByText('Save Settings').click()
    await expect.poll(() => lastPut?.church_signature_url).toBeNull()
  })

  it('surfaces server validation errors from the save response', async () => {
    seedSettings()
    worker.use(
      http.put('/api/settings', () =>
        HttpResponse.json(
          { error: 'Signature image must be a data URI in PNG or JPEG format' },
          { status: 400 },
        ),
      ),
    )
    const screen = await renderWithProviders(<Settings />, { auth: admin })

    await screen.getByText('Save Settings').click()
    await expect.element(
      screen.getByText('Signature image must be a data URI in PNG or JPEG format'),
    ).toBeVisible()
  })
})
