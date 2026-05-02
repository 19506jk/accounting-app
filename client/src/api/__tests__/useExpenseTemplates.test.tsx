import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../../test/renderWithProviders'
import { useExpenseTemplates } from '../useExpenseTemplates'

function ExpenseTemplatesProbe() {
  const { templates, saveTemplate, deleteTemplate } = useExpenseTemplates()

  return (
    <div>
      <button
        type='button'
        onClick={() => saveTemplate(
          '  Monthly Rent  ',
          { description: ' Rent payment ', payee_id: '10' },
          [{ expense_account_id: '5000', description: 'Office rent', tax_rate_id: 'HST' }]
        )}
      >
        Save template
      </button>
      <button
        type='button'
        onClick={() => {
          const first = templates[0]
          if (first) deleteTemplate(first.id)
        }}
      >
        Delete first
      </button>
      <div>Count:{templates.length}</div>
      <div>Name:{templates[0]?.name || '-'}</div>
      <div>Description:{templates[0]?.description || '-'}</div>
    </div>
  )
}

describe('useExpenseTemplates', () => {
  it('saves and deletes templates in user-scoped localStorage', async () => {
    const screen = await renderWithProviders(<ExpenseTemplatesProbe />, {
      auth: { id: 15, name: 'Templater', email: 'templater@example.com', role: 'admin', avatar_url: null },
    })

    await screen.getByRole('button', { name: 'Save template' }).click()
    await expect.element(screen.getByText('Count:1')).toBeVisible()
    await expect.element(screen.getByText('Name:Monthly Rent')).toBeVisible()
    await expect.element(screen.getByText('Description:Rent payment')).toBeVisible()

    const stored = localStorage.getItem('expense_entry_templates_u15')
    expect(stored || '').toContain('"name":"Monthly Rent"')

    await screen.getByRole('button', { name: 'Delete first' }).click()
    await expect.element(screen.getByText('Count:0')).toBeVisible()
  })
})
