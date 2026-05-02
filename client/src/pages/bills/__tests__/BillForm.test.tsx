import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../../test/msw/browser'
import { renderWithProviders } from '../../../test/renderWithProviders'
import BillForm from '../BillForm'

describe('BillForm', () => {
  it('shows read-only actions without save buttons', async () => {
    worker.use(
      http.get('/api/contacts', () => HttpResponse.json({ contacts: [] })),
      http.get('/api/accounts', () => HttpResponse.json({ accounts: [] })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] }))
    )
    const screen = renderWithProviders(
      <BillForm
        readOnly
        bill={{
          id: 11,
          contact_id: 22,
          date: '2026-03-01',
          due_date: '2026-03-15',
          amount: 120,
          amount_paid: 0,
          amount_outstanding: 120,
          fund_id: 1,
          status: 'UNPAID',
          vendor_name: 'Stationery Co',
          description: 'Supplies',
          line_items: [],
          is_voided: false,
        } as never}
        onClose={vi.fn()}
      />
    )

    await expect.element(screen.getByRole('button', { name: 'Close' })).toBeVisible()
    expect(screen.container.textContent || '').not.toContain('Save & Pay')
    expect(screen.container.textContent || '').not.toContain('Update')
  })

  it('submits create payload with selected vendor, fund, and line item details', async () => {
    const onSaved = vi.fn()
    let requestBody: unknown = null

    worker.use(
      http.get('/api/contacts', () => HttpResponse.json({
        contacts: [{ id: 22, name: 'Stationery Co', type: 'PAYEE' }],
      })),
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          {
            id: 310,
            code: '6100',
            name: 'Office Supplies',
            type: 'EXPENSE',
            account_class: 'EXPENSE',
            normal_balance: 'DEBIT',
            parent_id: null,
            is_active: true,
          },
        ],
      })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] })),
      http.post('/api/bills', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({
          bill: {
            id: 99,
            contact_id: 22,
            date: '2026-04-10',
            due_date: '2026-04-25',
            bill_number: 'INV-42',
            description: 'Office supplies restock',
            amount: 45,
            amount_paid: 0,
            status: 'UNPAID',
            fund_id: 1,
            transaction_id: null,
            created_transaction_id: null,
            created_by: 1,
            paid_by: null,
            paid_at: null,
            created_at: '2026-04-10T00:00:00.000Z',
            updated_at: '2026-04-10T00:00:00.000Z',
            line_items: [],
          },
        })
      })
    )

    const screen = renderWithProviders(
      <BillForm
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    )

    await userEvent.click(screen.getByText(/Select vendor/))
    await userEvent.click(screen.getByText('Stationery Co'))
    await userEvent.fill(screen.getByLabelText('Bill Date'), '2026-04-10')
    await userEvent.fill(screen.getByLabelText('Due Date'), '2026-04-25')
    await userEvent.fill(screen.getByLabelText('Bill Number'), 'INV-42')
    await userEvent.fill(screen.getByLabelText('Description'), 'Office supplies restock')
    await userEvent.click(screen.getByText(/Select\.\.\./))
    await userEvent.click(screen.getByText('6100 — Office Supplies'))
    await userEvent.fill(screen.getByPlaceholder('Description'), 'Paper and toner')
    await userEvent.fill(screen.getByLabelText('Amount (before tax) line 1'), '45')
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await vi.waitFor(() => {
      expect(requestBody).toEqual({
        contact_id: 22,
        date: '2026-04-10',
        due_date: '2026-04-25',
        bill_number: 'INV-42',
        description: 'Office supplies restock',
        amount: 45,
        fund_id: 1,
        line_items: [
          {
            expense_account_id: 310,
            description: 'Paper and toner',
            amount: 45,
            rounding_adjustment: 0,
            tax_rate_id: null,
          },
        ],
      })
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
  })

  it('shows validation errors for due date before bill date and invalid rounding precision', async () => {
    worker.use(
      http.get('/api/contacts', () => HttpResponse.json({
        contacts: [{ id: 22, name: 'Stationery Co', type: 'PAYEE' }],
      })),
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          {
            id: 310,
            code: '6100',
            name: 'Office Supplies',
            type: 'EXPENSE',
            account_class: 'EXPENSE',
            normal_balance: 'DEBIT',
            parent_id: null,
            is_active: true,
          },
        ],
      })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] })),
    )

    const screen = renderWithProviders(
      <BillForm
        onClose={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText(/Select vendor/))
    await userEvent.click(screen.getByText('Stationery Co'))
    await userEvent.fill(screen.getByLabelText('Bill Date'), '2026-05-10')
    await userEvent.fill(screen.getByLabelText('Due Date'), '2026-05-01')
    await userEvent.click(screen.getByText(/Select\.\.\./))
    await userEvent.click(screen.getByText('6100 — Office Supplies'))
    await userEvent.fill(screen.getByLabelText('Amount (before tax) line 1'), '25')
    await userEvent.fill(screen.getByLabelText('Rounding line 1'), '0.123')
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await expect.element(screen.getByText('Due date cannot be before bill date')).toBeVisible()
    await expect.element(screen.getByText('Max 2 decimal places')).toBeVisible()
  })

  it('submits credit payload as negative values and passes andPay option on Save & Pay', async () => {
    const onSaved = vi.fn()
    let requestBody: unknown = null

    worker.use(
      http.get('/api/contacts', () => HttpResponse.json({
        contacts: [{ id: 22, name: 'Stationery Co', type: 'PAYEE' }],
      })),
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          {
            id: 310,
            code: '6100',
            name: 'Office Supplies',
            type: 'EXPENSE',
            account_class: 'EXPENSE',
            normal_balance: 'DEBIT',
            parent_id: null,
            is_active: true,
          },
        ],
      })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] })),
      http.post('/api/bills', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({
          bill: {
            id: 121,
            contact_id: 22,
            date: '2026-04-10',
            due_date: '2026-04-25',
            bill_number: null,
            description: 'Credit adjustment',
            amount: -12,
            amount_paid: 0,
            status: 'UNPAID',
            fund_id: 1,
            line_items: [],
          },
        })
      }),
    )

    const screen = renderWithProviders(
      <BillForm
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    )

    await userEvent.click(screen.getByText(/Select vendor/))
    await userEvent.click(screen.getByText('Stationery Co'))
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'CREDIT')
    await userEvent.fill(screen.getByLabelText('Description'), 'Credit adjustment')
    await userEvent.click(screen.getByText(/Select\.\.\./))
    await userEvent.click(screen.getByText('6100 — Office Supplies'))
    await userEvent.fill(screen.getByLabelText('Amount (before tax) line 1'), '12')
    await userEvent.click(screen.getByRole('button', { name: 'Save & Pay' }))

    await vi.waitFor(() => {
      expect(requestBody).toEqual({
        contact_id: 22,
        date: expect.any(String),
        due_date: '',
        bill_number: null,
        description: 'Credit adjustment',
        amount: -12,
        fund_id: 1,
        line_items: [
          {
            expense_account_id: 310,
            description: '',
            amount: -12,
            rounding_adjustment: 0,
            tax_rate_id: null,
          },
        ],
      })
      expect(onSaved).toHaveBeenCalledTimes(1)
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ id: 121, amount: -12 }),
        { andPay: true },
      )
    })
  })

  it('retries update with confirm_unapply_credits when server requests confirmation', async () => {
    const onSaved = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const updateBodies: unknown[] = []

    worker.use(
      http.get('/api/contacts', () => HttpResponse.json({
        contacts: [{ id: 22, name: 'Stationery Co', type: 'PAYEE' }],
      })),
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          {
            id: 310,
            code: '6100',
            name: 'Office Supplies',
            type: 'EXPENSE',
            account_class: 'EXPENSE',
            normal_balance: 'DEBIT',
            parent_id: null,
            is_active: true,
          },
        ],
      })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] })),
      http.put('/api/bills/:id', async ({ request }) => {
        const body = await request.json()
        updateBodies.push(body)
        if (updateBodies.length === 1) {
          return HttpResponse.json({ error: 'Confirm unapply before save.' }, { status: 400 })
        }
        return HttpResponse.json({
          bill: {
            id: 200,
            contact_id: 22,
            date: '2026-04-10',
            due_date: '2026-04-25',
            amount: 45,
            amount_paid: 0,
            status: 'UNPAID',
            fund_id: 1,
            vendor_name: 'Stationery Co',
            description: 'Updated description',
            line_items: [],
            is_voided: false,
          },
        })
      }),
    )

    const screen = renderWithProviders(
      <BillForm
        bill={{
          id: 200,
          contact_id: 22,
          date: '2026-04-10',
          due_date: '2026-04-25',
          amount: 45,
          amount_paid: 0,
          amount_outstanding: 45,
          fund_id: 1,
          status: 'UNPAID',
          vendor_name: 'Stationery Co',
          description: 'Old description',
          line_items: [
            {
              id: 1,
              expense_account_id: 310,
              description: 'Paper and toner',
              amount: 45,
              rounding_adjustment: 0,
              tax_rate_id: null,
            },
          ],
          is_voided: false,
        } as never}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )

    await userEvent.fill(screen.getByLabelText('Description'), 'Updated description')
    await userEvent.click(screen.getByRole('button', { name: 'Update' }))

    await vi.waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(updateBodies).toHaveLength(2)
      expect(updateBodies[0]).toEqual(expect.not.objectContaining({ confirm_unapply_credits: true }))
      expect(updateBodies[1]).toEqual(expect.objectContaining({ confirm_unapply_credits: true }))
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
    confirmSpy.mockRestore()
  })

  it('does not retry update when confirm_unapply prompt is cancelled', async () => {
    const onSaved = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const updateBodies: unknown[] = []

    worker.use(
      http.get('/api/contacts', () => HttpResponse.json({
        contacts: [{ id: 22, name: 'Stationery Co', type: 'PAYEE' }],
      })),
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          {
            id: 310,
            code: '6100',
            name: 'Office Supplies',
            type: 'EXPENSE',
            account_class: 'EXPENSE',
            normal_balance: 'DEBIT',
            parent_id: null,
            is_active: true,
          },
        ],
      })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] })),
      http.put('/api/bills/:id', async ({ request }) => {
        const body = await request.json()
        updateBodies.push(body)
        return HttpResponse.json({ error: 'Confirm unapply before save.' }, { status: 400 })
      }),
    )

    const screen = renderWithProviders(
      <BillForm
        bill={{
          id: 201,
          contact_id: 22,
          date: '2026-04-10',
          due_date: '2026-04-25',
          amount: 45,
          amount_paid: 0,
          amount_outstanding: 45,
          fund_id: 1,
          status: 'UNPAID',
          vendor_name: 'Stationery Co',
          description: 'Old description',
          line_items: [
            {
              id: 1,
              expense_account_id: 310,
              description: 'Paper and toner',
              amount: 45,
              rounding_adjustment: 0,
              tax_rate_id: null,
            },
          ],
          is_voided: false,
        } as never}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Update' }))

    await vi.waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(updateBodies).toHaveLength(1)
      expect(onSaved).not.toHaveBeenCalled()
    })
    confirmSpy.mockRestore()
  })
})
