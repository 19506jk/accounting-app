import { useMemo, useState } from 'react'

import { useAccounts } from '../../api/useAccounts'
import { useBankMatchingRules, useDeleteBankMatchingRule } from '../../api/useBankMatchingRules'
import BankMatchingRuleModal from '../../components/bank/BankMatchingRuleModal'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Table from '../../components/ui/Table'
import { useToast } from '../../components/ui/Toast'
import { getErrorMessage } from '../../utils/errors'
import type { BankMatchingRule } from '@shared/contracts'
import type { TableColumn } from '../../components/ui/types'

interface RuleTableRow {
  id: number
  rule: BankMatchingRule
}

function formatMatch(rule: BankMatchingRule) {
  return `${rule.match_type} "${rule.match_pattern}"`
}

function getRuleScope(rule: BankMatchingRule, accountNameMap: Map<number, string>) {
  if (!rule.bank_account_id) return 'All accounts'
  return accountNameMap.get(rule.bank_account_id) || `Account #${rule.bank_account_id}`
}

export default function BankFeedRulesTab({ isActive }: { isActive: boolean }) {
  const { addToast } = useToast()
  const { data: rules = [], isLoading } = useBankMatchingRules({ enabled: isActive, includeInactive: true })
  const { data: accounts = [] } = useAccounts({ include_inactive: true })
  const deleteRuleMutation = useDeleteBankMatchingRule()

  const [editTarget, setEditTarget] = useState<BankMatchingRule | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  const accountNameMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, `${account.code} - ${account.name}`])),
    [accounts]
  )

  const rows = useMemo<RuleTableRow[]>(
    () => rules.map((rule) => ({ id: rule.id, rule })),
    [rules]
  )

  const columns = useMemo<TableColumn<RuleTableRow>[]>(() => [
    {
      key: 'name',
      label: 'Name',
      render: (row) => row.rule.name,
    },
    {
      key: 'type',
      label: 'Type',
      render: (row) => (
        <span
          style={{
            display: 'inline-flex',
            padding: '0.15rem 0.45rem',
            borderRadius: '999px',
            fontSize: '0.75rem',
            fontWeight: 600,
            background: row.rule.transaction_type === 'deposit' ? '#ecfeff' : '#fff7ed',
            color: row.rule.transaction_type === 'deposit' ? '#0e7490' : '#9a3412',
            border: row.rule.transaction_type === 'deposit' ? '1px solid #a5f3fc' : '1px solid #fdba74',
          }}
        >
          {row.rule.transaction_type}
        </span>
      ),
    },
    {
      key: 'match',
      label: 'Match',
      wrap: true,
      render: (row) => formatMatch(row.rule),
    },
    {
      key: 'priority',
      label: 'Priority',
      render: (row) => row.rule.priority,
    },
    {
      key: 'scope',
      label: 'Scope',
      wrap: true,
      render: (row) => getRuleScope(row.rule, accountNameMap),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <span
          style={{
            display: 'inline-flex',
            padding: '0.15rem 0.45rem',
            borderRadius: '999px',
            fontSize: '0.75rem',
            fontWeight: 600,
            background: row.rule.is_active ? '#f0fdf4' : '#f8fafc',
            color: row.rule.is_active ? '#166534' : '#475569',
            border: row.rule.is_active ? '1px solid #bbf7d0' : '1px solid #cbd5e1',
          }}
        >
          {row.rule.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => {
        const isConfirming = deleteConfirmId === row.rule.id
        const isDeleting = deleteRuleMutation.isPending && deleteConfirmId === row.rule.id
        if (isConfirming) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#b45309' }}>Confirm delete?</span>
              <Button
                size="sm"
                variant="danger"
                isLoading={isDeleting}
                onClick={() => void handleDelete(row.rule.id)}
              >
                Yes
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={isDeleting}
                onClick={() => setDeleteConfirmId(null)}
              >
                Cancel
              </Button>
            </div>
          )
        }
        return (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <Button
              size="sm"
              variant="secondary"
              disabled={deleteRuleMutation.isPending}
              onClick={() => {
                setDeleteConfirmId(null)
                setIsCreateOpen(false)
                setEditTarget(row.rule)
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={deleteRuleMutation.isPending}
              onClick={() => setDeleteConfirmId(row.rule.id)}
            >
              Delete
            </Button>
          </div>
        )
      },
    },
  ], [accountNameMap, deleteConfirmId, deleteRuleMutation.isPending])

  async function handleDelete(ruleId: number) {
    try {
      await deleteRuleMutation.mutateAsync(ruleId)
      setDeleteConfirmId(null)
      addToast('Rule deleted.', 'success')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to delete rule.'), 'error')
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <h2 style={{ margin: 0, color: '#1e293b', fontSize: '1rem', fontWeight: 700 }}>
            Bank Matching Rules
          </h2>
          <Button
            onClick={() => {
              setDeleteConfirmId(null)
              setEditTarget(null)
              setIsCreateOpen(true)
            }}
          >
            New Rule
          </Button>
        </div>

        <Table
          columns={columns}
          rows={rows}
          isLoading={isLoading}
          emptyText="No bank matching rules found."
        />
      </div>

      {(isCreateOpen || !!editTarget) && (
        <BankMatchingRuleModal
          rule={editTarget || undefined}
          onClose={() => {
            setIsCreateOpen(false)
            setEditTarget(null)
          }}
        />
      )}
    </Card>
  )
}
