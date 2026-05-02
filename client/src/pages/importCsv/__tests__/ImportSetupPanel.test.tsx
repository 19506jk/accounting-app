import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import ImportSetupPanel from '../ImportSetupPanel'

describe('ImportSetupPanel', () => {
  it('renders parse status and warnings', async () => {
    const screen = render(
      <ImportSetupPanel
        bankAccountId='1'
        fundId='2'
        bankAccountOptions={[{ value: 1, label: '1000 - Chequing' }]}
        fundOptions={[{ value: 2, label: 'General' }]}
        isParsing={false}
        parsedRowCount={3}
        parseError=''
        parseWarnings={['Row 2 had both deposit and withdrawal']}
        onFileChange={vi.fn()}
        onBankAccountChange={vi.fn()}
        onFundChange={vi.fn()}
      />
    )

    await expect.element(screen.getByText('3 rows found')).toBeVisible()
    await expect.element(screen.getByText('Row 2 had both deposit and withdrawal')).toBeVisible()
  })
})
