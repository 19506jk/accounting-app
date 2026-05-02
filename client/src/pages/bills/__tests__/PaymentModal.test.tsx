import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../../test/msw/browser'
import { renderWithProviders } from '../../../test/renderWithProviders'
import PaymentModal from '../PaymentModal'

const bill = {
  id: 9,
  contact_id: 14,
  date: '2026-04-01',
  due_date: '2026-04-15',
  bill_number: 'B-109',
  description: 'Quarterly supplies',
  amount: 100,
  amount_paid: 0,
  status: 'UNPAID',
  fund_id: 1,
  transaction_id: null,
  created_transaction_id: null,
  created_by: 1,
  paid_by: null,
  paid_at: null,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
  vendor_name: 'Northwind Supply',
  fund_name: 'General',
  created_by_name: 'Admin User',
  is_voided: false,
  line_items: [],
}

function mockPaymentModalRequests() {
  worker.use(
    http.get('/api/accounts', () => HttpResponse.json({
      accounts: [
        {
          id: 101,
          code: '10000',
          name: 'Checking',
          type: 'ASSET',
          account_class: 'ASSET',
          normal_balance: 'DEBIT',
          parent_id: null,
          is_active: true,
        },
      ],
    })),
    http.get('/api/bills/:id', () => HttpResponse.json({
      bill,
    })),
    http.get('/api/bills/:id/available-credits', () => HttpResponse.json({
      credits: [],
      target_bill_id: bill.id,
      target_outstanding: bill.amount - bill.amount_paid,
    }))
  )
}

async function selectBankAccount(screen: Awaited<ReturnType<typeof renderWithProviders>>) {
  await userEvent.click(screen.getByText('Select bank account...'))
  await userEvent.click(screen.getByText('10000 — Checking'))
}

describe('PaymentModal', () => {
  it('renders a stable empty-credits state for payable bills', async () => {
    mockPaymentModalRequests()

    const screen = await renderWithProviders(
      <PaymentModal
        bill={bill as never}
        isOpen
        onClose={vi.fn()}
      />
    )

    await expect.element(screen.getByRole('button', { name: 'Pay Bill' })).toBeVisible()
    await expect.element(screen.getByText('No available vendor credits for this bill.')).toBeVisible()
  })

  it('shows a bank account validation error before attempting payment', async () => {
    mockPaymentModalRequests()

    const screen = await renderWithProviders(
      <PaymentModal
        bill={bill as never}
        isOpen
        onClose={vi.fn()}
      />
    )

    await expect.element(screen.getByRole('button', { name: 'Pay Bill' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Pay Bill' }))
    await vi.waitFor(async () => {
      await expect.element(screen.getByText('Please select a bank account.')).toBeVisible()
    })
  })

  it('blocks payments that exceed the outstanding balance', async () => {
    mockPaymentModalRequests()

    const screen = await renderWithProviders(
      <PaymentModal
        bill={bill as never}
        isOpen
        onClose={vi.fn()}
      />
    )

    await expect.element(screen.getByRole('button', { name: 'Pay Bill' })).toBeVisible()
    await selectBankAccount(screen)
    await userEvent.clear(screen.getByLabelText('Payment Amount'))
    await userEvent.fill(screen.getByLabelText('Payment Amount'), '150')
    await userEvent.click(screen.getByRole('button', { name: 'Pay Bill' }))

    await vi.waitFor(async () => {
      await expect.element(screen.getByText('Payment cannot exceed the outstanding balance ($100.00).')).toBeVisible()
    })
  })

  it('submits a partial payment payload and closes on success', async () => {
    let requestBody: unknown = null
    let requestPath = ''
    const onClose = vi.fn()
    const onPaid = vi.fn()

    mockPaymentModalRequests()
    worker.use(
      http.post('/api/bills/:id/pay', async ({ request, params }) => {
        requestPath = `/api/bills/${params.id}/pay`
        requestBody = await request.json()
        return HttpResponse.json({
          bill: {
            ...bill,
            amount_paid: 25,
            status: 'UNPAID',
          },
        })
      })
    )

    const screen = await renderWithProviders(
      <PaymentModal
        bill={bill as never}
        isOpen
        onClose={onClose}
        onPaid={onPaid}
      />
    )

    await expect.element(screen.getByRole('button', { name: 'Pay Bill' })).toBeVisible()
    await selectBankAccount(screen)
    await userEvent.fill(screen.getByLabelText('Payment Date'), '2026-04-20')
    await userEvent.clear(screen.getByLabelText('Payment Amount'))
    await userEvent.fill(screen.getByLabelText('Payment Amount'), '25')
    await userEvent.fill(screen.getByLabelText('Reference No'), 'CHK-100')
    await userEvent.fill(screen.getByLabelText('Memo'), 'April installment')
    await userEvent.click(screen.getByRole('button', { name: 'Pay Bill' }))

    await vi.waitFor(async () => {
      expect(requestPath).toBe('/api/bills/9/pay')
      expect(requestBody).toEqual({
        payment_date: '2026-04-20',
        amount: 25,
        bank_account_id: 101,
        reference_no: 'CHK-100',
        memo: 'April installment',
      })
      expect(onPaid).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
      await expect.element(screen.getByText('Partial payment recorded.')).toBeVisible()
    })
  })
})
