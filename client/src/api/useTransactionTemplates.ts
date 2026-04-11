import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

interface TransactionTemplateRow {
  account_id: string
  fund_id: string
  contact_id: string
  memo: string
}

interface TransactionTemplate {
  id: string
  name: string
  description: string
  rows: TransactionTemplateRow[]
  created_at: string
}

interface HeaderSnapshot {
  description: string
}

interface EntrySnapshot {
  account_id: string
  fund_id: string
  contact_id: string
  memo: string
  [key: string]: unknown
}

function storageKey(userId: number | string) {
  return `transaction_entry_templates_u${userId}`
}

function readTemplates(userId: number | string): TransactionTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId)) || '[]')
  } catch {
    return []
  }
}

function persist(userId: number | string, data: TransactionTemplate[]): boolean {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function useTransactionTemplates() {
  const { user } = useAuth()
  const userId = user?.id ?? 'anon'

  const [templates, setTemplates] = useState<TransactionTemplate[]>(() => readTemplates(userId))

  useEffect(() => {
    setTemplates(readTemplates(userId))
  }, [userId])

  function saveTemplate(name: string, header: HeaderSnapshot, entries: EntrySnapshot[]): string | null {
    const trimmed = name.trim()

    if (!trimmed) return 'Template name is required.'
    if (!header.description.trim()) return 'Description must be filled in before saving a template.'

    const validRows = entries.filter((entry) => entry.account_id)
    if (validRows.length < 2) return 'At least two rows with an account are required (double-entry).'

    if (templates.some((template) => template.name === trimmed)) {
      return 'A template with that name already exists.'
    }

    const template: TransactionTemplate = {
      id: crypto.randomUUID(),
      name: trimmed,
      description: header.description.trim(),
      rows: validRows.map((entry) => ({
        account_id: entry.account_id,
        fund_id: entry.fund_id,
        contact_id: entry.contact_id,
        memo: entry.memo,
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
