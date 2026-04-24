import { useEffect, useMemo, useState } from 'react'

import type { AccessLogEntry, AuditAction, AuditEntityType, AuditLogEntry } from '@shared/contracts'
import { useAccessLog, useForensicLog } from '../api/useAuditLog'
import { useUsers } from '../api/useUsers'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import DateRangePicker from '../components/ui/DateRangePicker'
import Select from '../components/ui/Select'
import Table from '../components/ui/Table'
import type { TableColumn } from '../components/ui/types'
import { getErrorMessage } from '../utils/errors'

type TabKey = 'changes' | 'access'

const PAGE_SIZE = 50

const ACTION_OPTIONS: Array<{ value: '' | AuditAction; label: string }> = [
  { value: '', label: 'All actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'void', label: 'Void' },
  { value: 'close', label: 'Close' },
  { value: 'reopen', label: 'Reopen' },
  { value: 'pay', label: 'Pay' },
  { value: 'apply_credit', label: 'Apply Credit' },
  { value: 'unapply_credit', label: 'Unapply Credit' },
]

const ENTITY_OPTIONS: Array<{ value: '' | AuditEntityType; label: string }> = [
  { value: '', label: 'All entities' },
  { value: 'transaction', label: 'Transaction' },
  { value: 'bill', label: 'Bill' },
  { value: 'reconciliation', label: 'Reconciliation' },
  { value: 'fiscal_period', label: 'Fiscal Period' },
  { value: 'user', label: 'User' },
]

const OUTCOME_OPTIONS: Array<{ value: '' | AccessLogEntry['outcome']; label: string }> = [
  { value: '', label: 'All outcomes' },
  { value: 'success', label: 'Success' },
  { value: 'unauthorized', label: 'Unauthorized' },
  { value: 'error', label: 'Error' },
  { value: 'pending', label: 'Pending' },
]

function formatDateTime(value: string) {
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return value
  return dt.toLocaleString()
}

function formatFieldValue(value: unknown) {
  if (value === null) return 'null'
  if (typeof value === 'undefined') return 'undefined'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function actionBadgeStyle(action: string) {
  const map: Record<string, { bg: string; color: string }> = {
    create: { bg: '#dcfce7', color: '#15803d' },
    update: { bg: '#dbeafe', color: '#1d4ed8' },
    delete: { bg: '#fee2e2', color: '#b91c1c' },
    void: { bg: '#fef3c7', color: '#92400e' },
    close: { bg: '#e5e7eb', color: '#374151' },
    reopen: { bg: '#ede9fe', color: '#6d28d9' },
    pay: { bg: '#ccfbf1', color: '#0f766e' },
    apply_credit: { bg: '#dcfce7', color: '#15803d' },
    unapply_credit: { bg: '#ffedd5', color: '#9a3412' },
  }
  return map[action] || { bg: '#f3f4f6', color: '#4b5563' }
}

function outcomeBadgeStyle(outcome: AccessLogEntry['outcome']) {
  if (outcome === 'success') return { bg: '#dcfce7', color: '#15803d' }
  if (outcome === 'unauthorized') return { bg: '#fee2e2', color: '#b91c1c' }
  if (outcome === 'error') return { bg: '#fef3c7', color: '#92400e' }
  return { bg: '#f3f4f6', color: '#4b5563' }
}

function Pill({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.2rem 0.6rem',
      borderRadius: '999px',
      fontSize: '0.75rem',
      fontWeight: 600,
      textTransform: 'capitalize',
      background: bg,
      color,
      whiteSpace: 'nowrap',
    }}>
      {label.replace(/_/g, ' ')}
    </span>
  )
}

function DeltaCell({ row }: { row: AuditLogEntry }) {
  const fields = row.payload?.fields_changed ? Object.entries(row.payload.fields_changed) : []
  if (fields.length === 0) return <span style={{ color: '#9ca3af' }}>-</span>

  const visible = fields.slice(0, 3)
  const overflow = fields.length - visible.length

  return (
    <div style={{ display: 'grid', gap: '0.2rem' }}>
      {visible.map(([field, change]) => (
        <div key={field} style={{ fontSize: '0.78rem', color: '#334155' }}>
          <span style={{ fontWeight: 600 }}>{field}</span>
          {': '}
          <span style={{ color: '#64748b' }}>{formatFieldValue(change.from)}</span>
          {' -> '}
          <span style={{ color: '#0f766e' }}>{formatFieldValue(change.to)}</span>
        </div>
      ))}
      {overflow > 0 && (
        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
          +{overflow} more
        </div>
      )}
    </div>
  )
}

export default function AuditLog() {
  const [tab, setTab] = useState<TabKey>('changes')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [actorId, setActorId] = useState('')
  const [entityType, setEntityType] = useState<'' | AuditEntityType>('')
  const [action, setAction] = useState<'' | AuditAction>('')
  const [outcome, setOutcome] = useState<'' | AccessLogEntry['outcome']>('')
  const [forensicOffset, setForensicOffset] = useState(0)
  const [accessOffset, setAccessOffset] = useState(0)

  const actorIdNumber = actorId ? parseInt(actorId, 10) : undefined

  const { data: users = [] } = useUsers()
  const forensic = useForensicLog({
    from: from || undefined,
    to: to || undefined,
    actor_id: actorIdNumber,
    entity_type: entityType || undefined,
    action: action || undefined,
    limit: PAGE_SIZE,
    offset: forensicOffset,
  })
  const access = useAccessLog({
    from: from || undefined,
    to: to || undefined,
    actor_id: actorIdNumber,
    outcome: outcome || undefined,
    limit: PAGE_SIZE,
    offset: accessOffset,
  })

  useEffect(() => {
    setForensicOffset(0)
  }, [from, to, actorId, entityType, action])

  useEffect(() => {
    setAccessOffset(0)
  }, [from, to, actorId, outcome])

  const actorOptions = useMemo(
    () => [
      { value: '', label: 'All actors' },
      ...users.map((user) => ({ value: String(user.id), label: `${user.name} (${user.email})` })),
    ],
    [users]
  )

  const forensicColumns: TableColumn<AuditLogEntry>[] = [
    {
      key: 'created_at',
      label: 'Date / Time',
      render: (row) => (
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem' }}>
          {formatDateTime(row.created_at)}
        </span>
      ),
    },
    {
      key: 'actor',
      label: 'Who',
      render: (row) => (
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.82rem' }}>{row.actor_name}</div>
          <div style={{ color: '#64748b', fontSize: '0.74rem' }}>{row.actor_email}</div>
          <div style={{ marginTop: '0.2rem' }}>
            <Pill label={row.actor_role} bg="#f3f4f6" color="#4b5563" />
          </div>
        </div>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      render: (row) => {
        const style = actionBadgeStyle(row.action)
        return <Pill label={row.action} bg={style.bg} color={style.color} />
      },
    },
    {
      key: 'entity',
      label: 'Entity',
      render: (row) => (
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b' }}>
            {row.entity_type.replace(/_/g, ' ')} #{row.entity_id}
          </div>
          <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{row.entity_label || '-'}</div>
        </div>
      ),
    },
    {
      key: 'changes',
      label: 'Delta',
      wrap: true,
      render: (row) => <DeltaCell row={row} />,
    },
    {
      key: 'reason_note',
      label: 'Reason',
      wrap: true,
      render: (row) => row.reason_note || <span style={{ color: '#9ca3af' }}>-</span>,
    },
  ]

  const accessColumns: TableColumn<AccessLogEntry>[] = [
    {
      key: 'created_at',
      label: 'Date / Time',
      render: (row) => (
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem' }}>
          {formatDateTime(row.created_at)}
        </span>
      ),
    },
    {
      key: 'actor_email',
      label: 'Actor',
      render: (row) => row.actor_email || <span style={{ color: '#9ca3af' }}>(unauthenticated)</span>,
    },
    {
      key: 'request',
      label: 'Request',
      wrap: true,
      render: (row) => (
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem' }}>
          {row.request_method} {row.request_path}
        </span>
      ),
    },
    {
      key: 'outcome',
      label: 'Outcome',
      render: (row) => {
        const style = outcomeBadgeStyle(row.outcome)
        return <Pill label={row.outcome} bg={style.bg} color={style.color} />
      },
    },
    {
      key: 'ip_address',
      label: 'IP',
      render: (row) => (
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem' }}>
          {row.ip_address || '-'}
        </span>
      ),
    },
  ]

  const activeError = tab === 'changes' ? forensic.error : access.error
  const activeLoading = tab === 'changes' ? forensic.isLoading : access.isLoading
  const forensicRows = forensic.data?.audit_logs || []
  const accessRows = access.data?.access_logs || []
  const forensicTotal = forensic.data?.total ?? 0
  const accessTotal = access.data?.total ?? 0
  const activeRows = tab === 'changes' ? forensicRows : accessRows
  const activeTotal = tab === 'changes' ? forensicTotal : accessTotal
  const activeOffset = tab === 'changes' ? forensicOffset : accessOffset
  const canGoPrev = activeOffset > 0
  const canGoNext = activeOffset + PAGE_SIZE < activeTotal

  function clearFilters() {
    setFrom('')
    setTo('')
    setActorId('')
    setEntityType('')
    setAction('')
    setOutcome('')
    setForensicOffset(0)
    setAccessOffset(0)
  }

  function goPrev() {
    if (tab === 'changes') {
      setForensicOffset((prev) => Math.max(0, prev - PAGE_SIZE))
    } else {
      setAccessOffset((prev) => Math.max(0, prev - PAGE_SIZE))
    }
  }

  function goNext() {
    if (tab === 'changes') {
      setForensicOffset((prev) => prev + PAGE_SIZE)
    } else {
      setAccessOffset((prev) => prev + PAGE_SIZE)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Audit Log</h1>
          <p style={{ color: '#64748b', fontSize: '0.86rem', margin: '0.3rem 0 0' }}>
            Forensic changes and access attempts.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant={tab === 'changes' ? 'primary' : 'secondary'} onClick={() => setTab('changes')}>
            Changes
          </Button>
          <Button variant={tab === 'access' ? 'primary' : 'secondary'} onClick={() => setTab('access')}>
            Access
          </Button>
        </div>
      </div>

      <Card>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <DateRangePicker
            from={from}
            to={to}
            onChange={({ from: nextFrom, to: nextTo }) => {
              setFrom(nextFrom)
              setTo(nextTo)
            }}
          />
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Select label="Actor" value={actorId} onChange={(e) => setActorId(e.target.value)} options={actorOptions} />
            {tab === 'changes' && (
              <>
                <Select
                  label="Entity Type"
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value as '' | AuditEntityType)}
                  options={ENTITY_OPTIONS}
                />
                <Select
                  label="Action"
                  value={action}
                  onChange={(e) => setAction(e.target.value as '' | AuditAction)}
                  options={ACTION_OPTIONS}
                />
              </>
            )}
            {tab === 'access' && (
              <Select
                label="Outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as '' | AccessLogEntry['outcome'])}
                options={OUTCOME_OPTIONS}
              />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ color: '#6b7280', fontSize: '0.82rem' }}>
              Showing {activeRows.length} of {activeTotal}
            </div>
            <Button variant="secondary" onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      {activeError && (
        <Card style={{ borderColor: '#fecaca', background: '#fef2f2' }}>
          <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.86rem' }}>
            {getErrorMessage(activeError, 'Failed to load audit logs.')}
          </p>
        </Card>
      )}

      <Card style={{ padding: 0 }}>
        {tab === 'changes' ? (
          <Table
            columns={forensicColumns}
            rows={forensicRows}
            isLoading={activeLoading}
            emptyText="No forensic log entries found."
          />
        ) : (
          <Table
            columns={accessColumns}
            rows={accessRows}
            isLoading={activeLoading}
            emptyText="No access log entries found."
          />
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <Button variant="secondary" onClick={goPrev} disabled={!canGoPrev}>
          Previous
        </Button>
        <Button variant="secondary" onClick={goNext} disabled={!canGoNext}>
          Next
        </Button>
      </div>
    </div>
  )
}
