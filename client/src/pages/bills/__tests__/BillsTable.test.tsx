import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import BillsTable from '../BillsTable'

const bill = {
  id: 1,
  contact_id: 10,
  vendor_name: 'Northwind Supply',
  date: '2026-01-10',
  due_date: '2026-02-01',
  amount: 200,
  amount_paid: 0,
  amount_outstanding: 200,
  fund_id: 1,
  fund_name: 'General',
  status: 'UNPAID',
  description: 'Office supplies',
  bill_number: 'B-100',
  line_items: [{ id: 1 }],
  is_voided: false,
}

describe('BillsTable', () => {
  it('renders rows and pay action when editable unpaid bill has balance', async () => {
    const onPay = vi.fn()
    const onRowClick = vi.fn()
    const screen = render(
      <BillsTable
        bills={[bill as never]}
        isLoading={false}
        canEdit
        onPay={onPay}
        onRowClick={onRowClick}
      />
    )

    await expect.element(screen.getByText('Northwind Supply')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Pay' })).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Pay' }))
    expect(onPay).toHaveBeenCalledTimes(1)
  })
})
