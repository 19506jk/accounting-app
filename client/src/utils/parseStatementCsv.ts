import * as XLSX from 'xlsx'

import type { ImportTransactionRow } from '@shared/contracts'

interface RowMetadata {
  description_1: string
  sender: string
}

interface ParseStatementCsvResult {
  rows: ImportTransactionRow[]
  warnings: string[]
  metadata: RowMetadata[]
}

const DATE_ALIASES = ['Posted Date', 'Transaction Date', 'Date']
const DESCRIPTION_1_ALIASES = ['Description 1', 'Description', 'Payee']
const DESCRIPTION_2_ALIASES = ['Description 2', 'Details', 'Memo']
const WITHDRAWAL_ALIASES = ['Withdrawals', 'Debit', 'Amount Debit']
const DEPOSIT_ALIASES = ['Deposits', 'Credit', 'Amount Credit']
const REFERENCE_ALIASES = ['Interac Reference Number', 'Reference Number', 'Reference No']
const SENDER_ALIASES = ['Sender', 'Sender Name']

function normalizeHeader(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function getColumnIndex(headerRow: unknown[], aliases: string[]) {
  const aliasSet = new Set(aliases.map((value) => value.toLowerCase()))
  for (let i = 0; i < headerRow.length; i += 1) {
    if (aliasSet.has(normalizeHeader(headerRow[i]))) return i
  }
  return -1
}

function parsePostedDate(value: unknown, rowNumber: number) {
  const raw = String(value ?? '').trim()
  const normalized = raw.replace(/\.0+$/, '')
  if (!/^\d{8}$/.test(normalized)) {
    throw new Error(`Row ${rowNumber}: invalid date '${raw}'. Expected YYYYMMDD`)
  }

  const yyyy = normalized.slice(0, 4)
  const mm = normalized.slice(4, 6)
  const dd = normalized.slice(6, 8)
  const result = `${yyyy}-${mm}-${dd}`
  const parsed = new Date(`${result}T00:00:00Z`)

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error(`Row ${rowNumber}: invalid calendar date '${raw}'`)
  }

  return result
}

function parseAmount(value: unknown, rowNumber: number, label: 'Withdrawals' | 'Deposits') {
  if (value === null || value === undefined) return null

  const raw = String(value).trim()
  if (!raw) return null

  const hasParens = /^\(.*\)$/.test(raw)
  const withoutParens = hasParens ? raw.slice(1, -1) : raw
  const cleaned = withoutParens.replace(/,/g, '').replace(/\$/g, '').trim()
  if (!cleaned) return null

  const parsed = Number.parseFloat(cleaned)
  if (Number.isNaN(parsed)) {
    throw new Error(`Row ${rowNumber}: invalid ${label.toLowerCase()} amount '${raw}'`)
  }

  const normalized = hasParens ? Math.abs(parsed) : parsed
  if (normalized < 0) {
    throw new Error(`Row ${rowNumber}: ${label.toLowerCase()} amount cannot be negative`)
  }

  return normalized
}

export async function parseStatementCsv(file: File): Promise<ParseStatementCsvResult> {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) throw new Error('CSV file contains no sheets')

  const worksheet = workbook.Sheets[firstSheetName]
  if (!worksheet) throw new Error('Unable to read worksheet data')

  const rowsAsArrays = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]
  if (!rowsAsArrays.length) throw new Error('CSV file is empty')

  const headerRow = rowsAsArrays[0] || []
  const dateCol = getColumnIndex(headerRow, DATE_ALIASES)
  const desc1Col = getColumnIndex(headerRow, DESCRIPTION_1_ALIASES)
  const desc2Col = getColumnIndex(headerRow, DESCRIPTION_2_ALIASES)
  const withdrawalCol = getColumnIndex(headerRow, WITHDRAWAL_ALIASES)
  const depositCol = getColumnIndex(headerRow, DEPOSIT_ALIASES)
  const referenceCol = getColumnIndex(headerRow, REFERENCE_ALIASES)
  const senderCol = getColumnIndex(headerRow, SENDER_ALIASES)

  if (dateCol < 0) {
    throw new Error(`Required column '${DATE_ALIASES[0]}' not found`)
  }
  if (withdrawalCol < 0 && depositCol < 0) {
    throw new Error(`Required column '${WITHDRAWAL_ALIASES[0]}' or '${DEPOSIT_ALIASES[0]}' not found`)
  }

  const warnings: string[] = []
  const parsedRows: ImportTransactionRow[] = []
  const metadata: RowMetadata[] = []

  for (let i = 1; i < rowsAsArrays.length; i += 1) {
    const row = rowsAsArrays[i] || []
    const rowNumber = i + 1

    const withdrawal = withdrawalCol >= 0
      ? parseAmount(row[withdrawalCol], rowNumber, 'Withdrawals')
      : null
    const deposit = depositCol >= 0
      ? parseAmount(row[depositCol], rowNumber, 'Deposits')
      : null

    const withdrawalAmount = withdrawal || 0
    const depositAmount = deposit || 0

    if (withdrawalAmount <= 0 && depositAmount <= 0) continue

    if (withdrawalAmount > 0 && depositAmount > 0) {
      warnings.push(`Row ${rowNumber}: both Withdrawals and Deposits populated — skipped`)
      continue
    }

    const descriptionPart1 = desc1Col >= 0 ? String(row[desc1Col] ?? '').trim() : ''
    const descriptionPart2 = desc2Col >= 0 ? String(row[desc2Col] ?? '').trim() : ''
    const senderValue = senderCol >= 0 ? String(row[senderCol] ?? '').trim() : ''
    const description = [descriptionPart1, descriptionPart2].filter(Boolean).join(' — ') || 'Bank statement import'
    const reference = referenceCol >= 0 ? String(row[referenceCol] ?? '').trim() : ''

    parsedRows.push({
      date: parsePostedDate(row[dateCol], rowNumber),
      description,
      reference_no: reference || undefined,
      amount: withdrawalAmount > 0 ? withdrawalAmount : depositAmount,
      type: withdrawalAmount > 0 ? 'withdrawal' : 'deposit',
      offset_account_id: 0,
    })
    metadata.push({ description_1: descriptionPart1, sender: senderValue })
  }

  return {
    rows: parsedRows,
    warnings,
    metadata,
  }
}
