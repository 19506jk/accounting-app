import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

function buildStatementFile(rows: Array<Record<string, string>>, name: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

async function runParser(file: File) {
  const actualModulePath = '../parseStatementCsv?actual'
  const { parseStatementCsv } = await import(actualModulePath)
  return parseStatementCsv(file)
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

    const result = await runParser(file)

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

    const result = await runParser(file)
    expect(result.metadata[0]?.payment_method).toBe('')
  })

  it('parses withdrawal-only rows with formatted amounts and reference fields', async () => {
    const file = buildStatementFile([
      {
        'Posted Date': '20260403',
        'Description 1': 'Vendor A',
        'Description 2': 'Invoice 10',
        Withdrawals: '$1,234.56',
        Deposits: '',
        'Reference Number': 'INV-10',
      },
    ], 'statement-withdrawal.xlsx')

    const result = await runParser(file)

    expect(result.rows[0]).toEqual(expect.objectContaining({
      date: '2026-04-03',
      amount: 1234.56,
      type: 'withdrawal',
      reference_no: 'INV-10',
    }))
  })

  it('parses deposit-only rows and parenthesized amounts', async () => {
    const file = buildStatementFile([
      {
        'Posted Date': '20260404',
        Description: 'Donation',
        Debit: '',
        Credit: '(250.75)',
      },
    ], 'statement-deposit.xlsx')

    const result = await runParser(file)

    expect(result.rows[0]).toEqual(expect.objectContaining({
      date: '2026-04-04',
      amount: 250.75,
      type: 'deposit',
    }))
  })

  it('warns and skips rows where both withdrawals and deposits are populated', async () => {
    const file = buildStatementFile([
      {
        'Posted Date': '20260405',
        Description: 'Ambiguous row',
        Debit: '20',
        Credit: '10',
      },
    ], 'statement-ambiguous.xlsx')

    const result = await runParser(file)

    expect(result.rows).toHaveLength(0)
    expect(result.warnings).toEqual([
      'Row 2: both Withdrawals and Deposits populated — skipped',
    ])
  })

  it('throws when required date column is missing', async () => {
    const file = buildStatementFile([
      {
        Description: 'No date',
        Debit: '1',
      },
    ], 'statement-missing-date.xlsx')

    await expect(runParser(file)).rejects.toThrow("Required column 'Posted Date' not found")
  })

  it('throws for invalid posted date formats', async () => {
    const file = buildStatementFile([
      {
        'Posted Date': '2026-04-01',
        Description: 'Invalid date format',
        Debit: '',
        Credit: '25',
      },
    ], 'statement-invalid-date.xlsx')

    await expect(runParser(file)).rejects.toThrow("Row 2: invalid date '2026-04-01'. Expected YYYYMMDD")
  })

  it('throws for invalid calendar dates', async () => {
    const file = buildStatementFile([
      {
        'Posted Date': '20260230',
        Description: 'Impossible date',
        Debit: '',
        Credit: '25',
      },
    ], 'statement-invalid-calendar-date.xlsx')

    await expect(runParser(file)).rejects.toThrow("Row 2: invalid calendar date '20260230'")
  })
})
