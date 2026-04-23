import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { parseStatementCsv } from './parseStatementCsv'

function buildStatementFile(rows: Array<Record<string, string>>, name: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

describe('parseStatementCsv', () => {
  it('captures payment_method metadata when the column is present', async () => {
    const file = buildStatementFile([
      {
        'Posted Date': '20260401',
        'Description 1': 'E-TRANSFER - AUTODEPOSIT',
        'Description 2': 'Donation from Jane Doe',
        'Payment Method': 'Interac e-Transfer',
        Withdrawals: '',
        Deposits: '125.50',
        'Interac Reference Number': 'ABC123',
        Sender: 'Jane Doe',
        From: 'jane@example.com',
      },
    ], 'statement.xlsx')

    const result = await parseStatementCsv(file)

    expect(result.rows).toHaveLength(1)
    expect(result.metadata).toHaveLength(1)
    expect(result.metadata[0]).toEqual({
      description_1: 'E-TRANSFER - AUTODEPOSIT',
      description_2: 'Donation from Jane Doe',
      payment_method: 'Interac e-Transfer',
      sender: 'Jane Doe',
      from: 'jane@example.com',
    })
  })

  it('defaults payment_method metadata to empty string when the column is missing', async () => {
    const file = buildStatementFile([
      {
        'Posted Date': '20260402',
        Description: 'Manual Deposit',
        Debit: '',
        Credit: '50',
      },
    ], 'statement-no-method.xlsx')

    const result = await parseStatementCsv(file)
    expect(result.metadata[0]?.payment_method).toBe('')
  })
})
