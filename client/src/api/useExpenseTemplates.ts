import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import type { OptionValue } from '../components/ui/types'

export interface ExpenseTemplateRow {
  expense_account_id: OptionValue
  description: string
  tax_rate_id: string
}

export interface ExpenseTemplate {
  id: string
  name: string
  description: string
  payee_id: OptionValue
  rows: ExpenseTemplateRow[]
  created_at: string
}

interface HeaderSnapshot {
  description: string
  payee_id: OptionValue | ''
}

interface LineSnapshot {
  expense_account_id: OptionValue | ''
  description: string
  tax_rate_id: string
}

function storageKey(userId: number | string) {
  return `expense_entry_templates_u${userId}`
}

function readTemplates(userId: number | string): ExpenseTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId)) || '[]')
  } catch {
    return []
  }
}

function persist(userId: number | string, data: ExpenseTemplate[]): boolean {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function useExpenseTemplates() {
  const { user } = useAuth()
  const userId = user?.id ?? 'anon'

  const [templates, setTemplates] = useState<ExpenseTemplate[]>(() => readTemplates(userId))

  useEffect(() => {
    setTemplates(readTemplates(userId))
  }, [userId])

  function saveTemplate(name: string, header: HeaderSnapshot, lines: LineSnapshot[]): string | null {
    const trimmed = name.trim()

    if (!trimmed) return 'Template name is required.'
    if (!header.description.trim()) return 'Description must be filled in before saving a template.'
    if (!header.payee_id) return 'Payee must be selected before saving a template.'

    const validRows = lines.filter((line) => line.expense_account_id)
    if (validRows.length === 0) return 'At least one row with an expense account is required.'

    if (templates.some((template) => template.name === trimmed)) {
      return 'A template with that name already exists.'
    }

    const template: ExpenseTemplate = {
      id: crypto.randomUUID(),
      name: trimmed,
      description: header.description.trim(),
      payee_id: header.payee_id,
      rows: validRows.map((line) => ({
        expense_account_id: line.expense_account_id,
        description: line.description,
        tax_rate_id: line.tax_rate_id,
      })),
      created_at: new Date().toISOString(),
    }

    const updated = [...templates, template]
    const didPersist = persist(userId, updated)
    if (!didPersist) return 'Could not save template: storage is unavailable or full.'

    setTemplates(updated)
    return null
  }

  function deleteTemplate(id: string): string | null {
    const updated = templates.filter((template) => template.id !== id)
    const didPersist = persist(userId, updated)
    if (!didPersist) return 'Could not delete template: storage is unavailable or full.'

    setTemplates(updated)
    return null
  }

  return { templates, saveTemplate, deleteTemplate }
}
