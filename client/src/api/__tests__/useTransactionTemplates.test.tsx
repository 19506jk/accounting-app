import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../../test/renderWithProviders'
import { useTransactionTemplates } from '../useTransactionTemplates'

function TransactionTemplatesProbe() {
  const { templates, saveTemplate, deleteTemplate } = useTransactionTemplates()

  return (
    <div>
      <button
        type='button'
        onClick={() => saveTemplate(
          '  Sunday Offering  ',
          { description: ' Weekly donation batch ' },
          [
            { account_id: '1000', fund_id: '1', contact_id: '', memo: 'deposit' },
            { account_id: '4000', fund_id: '1', contact_id: '', memo: 'income' },
          ]
        )}
      >
        Save tx template
      </button>
      <button
        type='button'
        onClick={() => {
          const first = templates[0]
          if (first) deleteTemplate(first.id)
        }}
      >
        Delete tx template
      </button>
      <div>Count:{templates.length}</div>
      <div>Name:{templates[0]?.name || '-'}</div>
      <div>Description:{templates[0]?.description || '-'}</div>
      <div>Rows:{templates[0]?.rows.length || 0}</div>
    </div>
  )
}

describe('useTransactionTemplates', () => {
  it('saves and deletes transaction templates in user-scoped localStorage', async () => {
    const screen = await renderWithProviders(<TransactionTemplatesProbe />, {
      auth: { id: 19, name: 'Bookkeeper', email: 'bookkeeper@example.com', role: 'admin', avatar_url: null },
    })

    await screen.getByRole('button', { name: 'Save tx template' }).click()
    await expect.element(screen.getByText('Count:1')).toBeVisible()
    await expect.element(screen.getByText('Name:Sunday Offering')).toBeVisible()
    await expect.element(screen.getByText('Description:Weekly donation batch')).toBeVisible()
    await expect.element(screen.getByText('Rows:2')).toBeVisible()

    const stored = localStorage.getItem('transaction_entry_templates_u19')
    expect(stored || '').toContain('"name":"Sunday Offering"')

    await screen.getByRole('button', { name: 'Delete tx template' }).click()
    await expect.element(screen.getByText('Count:0')).toBeVisible()
  })

  it('persists debit and credit values in saved templates', async () => {
    function Probe() {
      const { templates, saveTemplate } = useTransactionTemplates()
      return (
        <div>
          <button
            type='button'
            onClick={() => saveTemplate(
              'Amounts Template',
              { description: 'With amounts' },
              [
                { account_id: '1000', fund_id: '1', contact_id: '', memo: 'bank', debit: '500.00', credit: '' },
                { account_id: '4000', fund_id: '1', contact_id: '', memo: 'income', debit: '', credit: '500.00' },
              ]
            )}
          >
            Save with amounts
          </button>
          <div>Count:{templates.length}</div>
          <div>Debit:{templates[0]?.rows[0]?.debit ?? 'missing'}</div>
          <div>Credit:{templates[0]?.rows[1]?.credit ?? 'missing'}</div>
        </div>
      )
    }

    const screen = await renderWithProviders(<Probe />, {
      auth: { id: 20, name: 'Tester', email: 'tester@example.com', role: 'admin', avatar_url: null },
    })

    await screen.getByRole('button', { name: 'Save with amounts' }).click()
    await expect.element(screen.getByText('Count:1')).toBeVisible()
    await expect.element(screen.getByText('Debit:500.00')).toBeVisible()
    await expect.element(screen.getByText('Credit:500.00')).toBeVisible()

    const stored = localStorage.getItem('transaction_entry_templates_u20')
    const parsed = JSON.parse(stored || '[]')
    expect(parsed[0].rows[0].debit).toBe('500.00')
    expect(parsed[0].rows[0].credit).toBe('')
    expect(parsed[0].rows[1].debit).toBe('')
    expect(parsed[0].rows[1].credit).toBe('500.00')
  })

  it('loads legacy templates without debit/credit keys without errors', async () => {
    const legacy = [{
      id: 'legacy-1',
      name: 'Old Template',
      description: 'No amounts',
      rows: [
        { account_id: '1000', fund_id: '1', contact_id: '', memo: 'old row' },
      ],
      created_at: '2025-01-01T00:00:00.000Z',
    }]
    localStorage.setItem('transaction_entry_templates_u21', JSON.stringify(legacy))

    function Probe() {
      const { templates } = useTransactionTemplates()
      const row = templates[0]?.rows[0]
      return (
        <div>
          <div>Count:{templates.length}</div>
          <div>Debit:{row?.debit ?? 'empty'}</div>
          <div>Credit:{row?.credit ?? 'empty'}</div>
        </div>
      )
    }

    const screen = await renderWithProviders(<Probe />, {
      auth: { id: 21, name: 'Legacy', email: 'legacy@example.com', role: 'admin', avatar_url: null },
    })

    await expect.element(screen.getByText('Count:1')).toBeVisible()
    await expect.element(screen.getByText('Debit:empty')).toBeVisible()
    await expect.element(screen.getByText('Credit:empty')).toBeVisible()
  })
})
