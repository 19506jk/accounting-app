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
})
