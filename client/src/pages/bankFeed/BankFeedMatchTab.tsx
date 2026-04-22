import { useEffect, useMemo, useState } from 'react'

import {
  useApproveMatch,
  useBankTransactions,
  useConfirmMatch,
  useCreateFromBankRow,
  useHoldBankTransaction,
  useIgnoreBankTransaction,
  useOverrideMatch,
  useRejectCandidate,
  useReleaseHold,
  useReleaseReservation,
  useReserve,
  useScanCandidates,
  useUnignoreBankTransaction,
} from '../../api/useBankTransactions'
import { useGetBillMatches } from '../../api/useTransactions'
import CreateFromBankRowModal from '../../components/bank/CreateFromBankRowModal'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { getErrorMessage } from '../../utils/errors'
import {
  buildBillMatchRequestGroups,
  formatCurrency,
  groupBillSuggestions,
} from './bankFeedHelpers'
import type { BankTransaction, BillMatchSuggestion, MatchCandidate } from '@shared/contracts'
import type React from 'react'
import type { BillMatchRowWithAccount } from './bankFeedHelpers'

interface AutoConfirmedResult {
  bankTransactionId: number
  bankPostedDate: string
  amount: number
  rawDescription: string
  candidate: MatchCandidate
  confirmedAt: number
}

type ReasonAction = 'hold' | 'ignore'

interface CreateBillMatchRow extends BillMatchRowWithAccount {
  type: 'withdrawal'
}

function useBankFeedMatchTab(isActive: boolean) {
  const { addToast } = useToast()
  const { data: matchItems = [], isLoading: isLoadingMatchItems } = useBankTransactions({
    status: ['imported', 'matched_existing', 'created_new'],
    lifecycle_status: 'open',
  }, { enabled: isActive })
  const createFromBankMutation = useCreateFromBankRow()
  const getBillMatches = useGetBillMatches()
  const scanMutation = useScanCandidates()
  const reserveMutation = useReserve()
  const confirmMutation = useConfirmMatch()
  const rejectMutation = useRejectCandidate()
  const releaseMutation = useReleaseReservation()
  const holdMutation = useHoldBankTransaction()
  const releaseHoldMutation = useReleaseHold()
  const ignoreMutation = useIgnoreBankTransaction()
  const unignoreMutation = useUnignoreBankTransaction()
  const approveMutation = useApproveMatch()
  const overrideMutation = useOverrideMatch()
  const [scanningId, setScanningId] = useState<number | null>(null)
  const [reservingKey, setReservingKey] = useState<string | null>(null)
  const [rejectingKey, setRejectingKey] = useState<string | null>(null)
  const [releasingId, setReleasingId] = useState<number | null>(null)
  const [holdingId, setHoldingId] = useState<number | null>(null)
  const [releaseHoldingId, setReleaseHoldingId] = useState<number | null>(null)
  const [ignoringId, setIgnoringId] = useState<number | null>(null)
  const [unignoringId, setUnignoringId] = useState<number | null>(null)
  const [approvingId, setApprovingId] = useState<number | null>(null)
  const [overridingId, setOverridingId] = useState<number | null>(null)
  const [payingBillKey, setPayingBillKey] = useState<string | null>(null)
  const [scanResults, setScanResults] = useState<Record<number, MatchCandidate[]>>({})
  const [billSuggestionsByRow, setBillSuggestionsByRow] = useState<Record<number, BillMatchSuggestion[]>>({})
  const [autoConfirmedResults, setAutoConfirmedResults] = useState<Record<number, AutoConfirmedResult>>({})
  const [createModalTarget, setCreateModalTarget] = useState<number | null>(null)
  const [reasonTarget, setReasonTarget] = useState<{ id: number; action: ReasonAction } | null>(null)
  const [reasonNote, setReasonNote] = useState('')

  const {
    matchQueueItems,
    pendingReviewItems,
    createItems,
    heldItems,
    ignoredItems,
  } = useMemo(() => {
    const nextMatchQueueItems: BankTransaction[] = []
    const nextPendingReviewItems: BankTransaction[] = []
    const nextCreateItems: BankTransaction[] = []
    const nextHeldItems: BankTransaction[] = []
    const nextIgnoredItems: BankTransaction[] = []

    matchItems.forEach((item) => {
      if (
        item.disposition === 'none'
        && item.creation_status === 'none'
        && (item.match_status === 'none' || item.match_status === 'suggested')
      ) {
        nextMatchQueueItems.push(item)
      }

      if (
        item.match_status === 'confirmed'
        && item.match_source === 'system'
        && item.review_status === 'pending'
        && item.disposition === 'none'
      ) {
        nextPendingReviewItems.push(item)
      }

      if (
        item.disposition !== 'hold'
        && item.disposition !== 'ignored'
        && (
          item.creation_status === 'suggested_create'
          || (item.creation_status === 'none' && item.match_status === 'rejected')
        )
      ) {
        nextCreateItems.push(item)
      }

      if (item.disposition === 'hold') nextHeldItems.push(item)
      if (item.disposition === 'ignored') nextIgnoredItems.push(item)
    })

    return {
      matchQueueItems: nextMatchQueueItems,
      pendingReviewItems: nextPendingReviewItems,
      createItems: nextCreateItems,
      heldItems: nextHeldItems,
      ignoredItems: nextIgnoredItems,
    }
  }, [matchItems])

  const autoConfirmedCards = useMemo(
    () => Object.values(autoConfirmedResults).sort((a, b) => b.confirmedAt - a.confirmedAt),
    [autoConfirmedResults]
  )
  const selectedCreateItem = useMemo(
    () => matchItems.find((item) => item.id === createModalTarget) || null,
    [createModalTarget, matchItems]
  )
  const createBillMatchRows = useMemo<CreateBillMatchRow[]>(
    () => createItems
      .filter((item) => item.amount < 0)
      .map((item) => ({
        row_index: item.id,
        date: item.bank_posted_date,
        amount: Math.abs(item.amount),
        type: 'withdrawal',
        account_id: item.account_id,
      })),
    [createItems]
  )
  const createBillMatchKey = useMemo(
    () => createBillMatchRows.map((row) => `${row.row_index}:${row.date}:${row.amount}:${row.account_id}`).join('|'),
    [createBillMatchRows]
  )

  useEffect(() => {
    if (!isActive) return
    if (createBillMatchRows.length === 0) {
      setBillSuggestionsByRow({})
      return
    }

    let cancelled = false
    const requestGroups = buildBillMatchRequestGroups(createBillMatchRows)

    Promise.all(requestGroups.map((payload) => getBillMatches.mutateAsync(payload))).then((results) => {
      if (cancelled) return
      const suggestions = results.flatMap((result) => result.suggestions || [])
      setBillSuggestionsByRow(groupBillSuggestions(suggestions))
    }).catch((err) => {
      if (!cancelled) {
        setBillSuggestionsByRow({})
        addToast(getErrorMessage(err, 'Failed to load bill suggestions.'), 'error')
      }
    })

    return () => {
      cancelled = true
    }
  }, [isActive, createBillMatchKey, getBillMatches.mutateAsync])

  async function handleScan(id: number) {
    setScanningId(id)
    const queueSnapshot = matchItems.find((item) => item.id === id) || null
    try {
      const result = await scanMutation.mutateAsync(id)
      const autoConfirmed = result.auto_confirmed
      if (autoConfirmed) {
        setScanResults((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setAutoConfirmedResults((prev) => {
          const existing = prev[id]
          const bankPostedDate = queueSnapshot?.bank_posted_date || existing?.bankPostedDate || ''
          const amount = queueSnapshot?.amount ?? existing?.amount ?? 0
          const rawDescription = queueSnapshot?.raw_description || existing?.rawDescription || ''
          return {
            ...prev,
            [id]: {
              bankTransactionId: id,
              bankPostedDate,
              amount,
              rawDescription,
              candidate: autoConfirmed,
              confirmedAt: Date.now(),
            },
          }
        })
      } else if (result.candidates.length === 0) {
        addToast('No matches found. Moved to Create Queue.', 'success')
      } else {
        setScanResults((prev) => ({ ...prev, [id]: result.candidates }))
        addToast(`Found ${result.candidates.length} candidate(s).`, 'success')
      }
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to scan candidates.'), 'error')
    } finally {
      setScanningId(null)
    }
  }

  async function handleReserveAndConfirm(bankTransactionId: number, candidate: MatchCandidate) {
    const key = `${bankTransactionId}:${candidate.journal_entry_id}`
    setReservingKey(key)
    try {
      await reserveMutation.mutateAsync({
        id: bankTransactionId,
        payload: { journal_entry_id: candidate.journal_entry_id },
      })
      await confirmMutation.mutateAsync({
        id: bankTransactionId,
        payload: { journal_entry_id: candidate.journal_entry_id },
      })
      addToast('Match confirmed.', 'success')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to reserve and confirm match.'), 'error')
    } finally {
      setReservingKey(null)
    }
  }

  async function handleRejectCandidate(bankTransactionId: number, candidate: MatchCandidate) {
    const key = `${bankTransactionId}:${candidate.journal_entry_id}`
    setRejectingKey(key)
    try {
      await rejectMutation.mutateAsync({
        id: bankTransactionId,
        payload: { journal_entry_id: candidate.journal_entry_id },
      })
      setScanResults((prev) => ({
        ...prev,
        [bankTransactionId]: (prev[bankTransactionId] || []).filter((item) => (
          item.journal_entry_id !== candidate.journal_entry_id
        )),
      }))
      addToast('Candidate rejected.', 'success')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to reject candidate.'), 'error')
    } finally {
      setRejectingKey(null)
    }
  }

  async function handleReleaseReservation(bankTransactionId: number) {
    setReleasingId(bankTransactionId)
    try {
      await releaseMutation.mutateAsync(bankTransactionId)
      addToast('Reservation released.', 'success')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to release reservation.'), 'error')
    } finally {
      setReleasingId(null)
    }
  }

  function dismissAutoConfirmedCard(bankTransactionId: number) {
    setAutoConfirmedResults((prev) => {
      const next = { ...prev }
      delete next[bankTransactionId]
      return next
    })
  }

  function openReasonDialog(id: number, action: ReasonAction) {
    setReasonTarget({ id, action })
    setReasonNote('')
  }

  function closeReasonDialog() {
    if (holdMutation.isPending || ignoreMutation.isPending) return
    setReasonTarget(null)
    setReasonNote('')
  }

  async function submitReasonDialog() {
    if (!reasonTarget) return
    const trimmedReason = reasonNote.trim()
    const payload = { reason_note: trimmedReason ? trimmedReason : undefined }

    if (reasonTarget.action === 'hold') {
      setHoldingId(reasonTarget.id)
      try {
        await holdMutation.mutateAsync({ id: reasonTarget.id, payload })
        addToast('Row moved to hold.', 'success')
        setReasonTarget(null)
        setReasonNote('')
      } catch (err) {
        addToast(getErrorMessage(err, 'Failed to hold row.'), 'error')
      } finally {
        setHoldingId(null)
      }
      return
    }

    setIgnoringId(reasonTarget.id)
    try {
      await ignoreMutation.mutateAsync({ id: reasonTarget.id, payload })
      addToast('Row ignored.', 'success')
      setReasonTarget(null)
      setReasonNote('')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to ignore row.'), 'error')
    } finally {
      setIgnoringId(null)
    }
  }

  async function handleReleaseHold(id: number) {
    setReleaseHoldingId(id)
    try {
      await releaseHoldMutation.mutateAsync(id)
      addToast('Hold released and row reset.', 'success')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to release hold.'), 'error')
    } finally {
      setReleaseHoldingId(null)
    }
  }

  async function handleUnignore(id: number) {
    setUnignoringId(id)
    try {
      await unignoreMutation.mutateAsync(id)
      addToast('Ignored row restored.', 'success')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to restore ignored row.'), 'error')
    } finally {
      setUnignoringId(null)
    }
  }

  async function handleApproveMatch(id: number) {
    setApprovingId(id)
    try {
      await approveMutation.mutateAsync(id)
      addToast('System match approved.', 'success')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to approve match.'), 'error')
    } finally {
      setApprovingId(null)
    }
  }

  async function handleOverrideMatch(id: number) {
    setOverridingId(id)
    try {
      await overrideMutation.mutateAsync(id)
      addToast('System match overridden and reset.', 'success')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to override match.'), 'error')
    } finally {
      setOverridingId(null)
    }
  }

  async function handlePayBill(item: BankTransaction, suggestion: BillMatchSuggestion) {
    const key = `${item.id}:${suggestion.bill_id}`
    setPayingBillKey(key)
    try {
      await createFromBankMutation.mutateAsync({
        id: item.id,
        payload: {
          date: item.bank_posted_date,
          description: item.bank_description_2
            ? `${item.raw_description} — ${item.bank_description_2}`
            : item.raw_description,
          reference_no: item.bank_transaction_id || undefined,
          amount: Math.abs(item.amount),
          type: 'withdrawal',
          bill_id: suggestion.bill_id,
        },
      })
      addToast('Bill payment created from bank row.', 'success')
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to pay bill from bank row.'), 'error')
    } finally {
      setPayingBillKey(null)
    }
  }

  return {
    autoConfirmedCards,
    pendingReviewItems,
    createItems,
    matchQueueItems,
    heldItems,
    ignoredItems,
    selectedCreateItem,
    isLoadingMatchItems,
    scanResults,
    billSuggestionsByRow,
    scanningId,
    reservingKey,
    rejectingKey,
    releasingId,
    holdingId,
    releaseHoldingId,
    ignoringId,
    unignoringId,
    approvingId,
    overridingId,
    payingBillKey,
    reasonTarget,
    reasonNote,
    holdMutation,
    ignoreMutation,
    setReasonNote,
    setCreateModalTarget,
    dismissAutoConfirmedCard,
    handleScan,
    handleReserveAndConfirm,
    handleRejectCandidate,
    handleReleaseReservation,
    openReasonDialog,
    closeReasonDialog,
    submitReasonDialog,
    handleReleaseHold,
    handleUnignore,
    handleApproveMatch,
    handleOverrideMatch,
    handlePayBill,
    addToast,
  }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontWeight: 600, color: '#0f172a' }}>
      {children}
    </div>
  )
}

function BankRowSummary({
  item,
  textColor = '#0f172a',
  descriptionColor = '#475569',
  children,
}: {
  item: BankTransaction
  textColor?: string
  descriptionColor?: string
  children?: React.ReactNode
}) {
  return (
    <div>
      <div style={{ fontSize: '0.85rem', color: textColor, fontWeight: 600 }}>
        {item.bank_posted_date} • {formatCurrency(item.amount)}
      </div>
      <div style={{ fontSize: '0.82rem', color: descriptionColor }}>{item.raw_description}</div>
      {children}
    </div>
  )
}

function AutoConfirmedMatchCard({
  result,
  onDismiss,
}: {
  result: AutoConfirmedResult
  onDismiss: (bankTransactionId: number) => void
}) {
  return (
    <div
      style={{
        border: '1px solid #86efac',
        borderRadius: '8px',
        padding: '0.8rem',
        background: '#f0fdf4',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center' }}>
        <div style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 600 }}>
          Auto-confirmed match
        </div>
        <Button
          variant="secondary"
          onClick={() => onDismiss(result.bankTransactionId)}
        >
          Dismiss
        </Button>
      </div>
      <div style={{ marginTop: '0.45rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
        <div style={{ border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.55rem', background: '#f7fee7' }}>
          <div style={{ fontSize: '0.75rem', color: '#166534', marginBottom: '0.3rem' }}>Bank transaction</div>
          <div style={{ fontSize: '0.82rem', color: '#14532d' }}>{result.bankPostedDate} • {formatCurrency(result.amount)}</div>
          <div style={{ fontSize: '0.8rem', color: '#166534' }}>{result.rawDescription || 'No description'}</div>
        </div>
        <div style={{ border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.55rem', background: '#f7fee7' }}>
          <div style={{ fontSize: '0.75rem', color: '#166534', marginBottom: '0.3rem' }}>Journal entry</div>
          <div style={{ fontSize: '0.82rem', color: '#14532d' }}>
            JE #{result.candidate.journal_entry_id} • {result.candidate.date}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#166534' }}>{result.candidate.description}</div>
          <div style={{ fontSize: '0.76rem', color: '#166534' }}>
            Ref {result.candidate.score_ref} · Date {result.candidate.score_date} · Desc {result.candidate.score_desc} · Total {result.candidate.score_total}
          </div>
        </div>
      </div>
    </div>
  )
}

function PendingReviewRow({
  item,
  approvingId,
  overridingId,
  onApprove,
  onOverride,
}: {
  item: BankTransaction
  approvingId: number | null
  overridingId: number | null
  onApprove: (id: number) => void
  onOverride: (id: number) => void
}) {
  return (
    <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: '8px', padding: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center' }}>
        <BankRowSummary item={item} textColor="#854d0e" descriptionColor="#92400e">
          {item.matched_journal_entry_id && (
            <div style={{ fontSize: '0.78rem', color: '#a16207' }}>
              Matched JE #{item.matched_journal_entry_id}
            </div>
          )}
        </BankRowSummary>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            variant="secondary"
            onClick={() => onOverride(item.id)}
            isLoading={overridingId === item.id}
          >
            Override
          </Button>
          <Button
            onClick={() => onApprove(item.id)}
            isLoading={approvingId === item.id}
          >
            Approve
          </Button>
        </div>
      </div>
    </div>
  )
}

function CreateQueueRow({
  item,
  suggestions,
  payingBillKey,
  holdingId,
  ignoringId,
  onPayBill,
  onHold,
  onIgnore,
  onCreate,
}: {
  item: BankTransaction
  suggestions: BillMatchSuggestion[]
  payingBillKey: string | null
  holdingId: number | null
  ignoringId: number | null
  onPayBill: (item: BankTransaction, suggestion: BillMatchSuggestion) => void
  onHold: (id: number) => void
  onIgnore: (id: number) => void
  onCreate: (id: number) => void
}) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center' }}>
        <BankRowSummary item={item}>
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.55rem' }}>
              {suggestions.map((suggestion) => {
                const key = `${item.id}:${suggestion.bill_id}`
                return (
                  <Button
                    key={key}
                    variant="secondary"
                    size="sm"
                    onClick={() => onPayBill(item, suggestion)}
                    isLoading={payingBillKey === key}
                  >
                    Pay {suggestion.confidence === 'exact' ? 'Exact' : 'Possible'} Bill {suggestion.bill_number || `#${suggestion.bill_id}`} - {suggestion.vendor_name || 'Unknown vendor'} {formatCurrency(suggestion.balance_due)}
                  </Button>
                )
              })}
            </div>
          )}
        </BankRowSummary>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            variant="secondary"
            onClick={() => onHold(item.id)}
            isLoading={holdingId === item.id}
          >
            Hold
          </Button>
          <Button
            variant="secondary"
            onClick={() => onIgnore(item.id)}
            isLoading={ignoringId === item.id}
          >
            Ignore
          </Button>
          <Button onClick={() => onCreate(item.id)}>
            Create New JE
          </Button>
        </div>
      </div>
    </div>
  )
}

function MatchCandidateCard({
  item,
  candidate,
  rejectingKey,
  reservingKey,
  onReject,
  onReserveAndConfirm,
}: {
  item: BankTransaction
  candidate: MatchCandidate
  rejectingKey: string | null
  reservingKey: string | null
  onReject: (bankTransactionId: number, candidate: MatchCandidate) => void
  onReserveAndConfirm: (bankTransactionId: number, candidate: MatchCandidate) => void
}) {
  const key = `${item.id}:${candidate.journal_entry_id}`

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.6rem' }}>
      <div style={{ fontSize: '0.82rem', color: '#0f172a', fontWeight: 600 }}>
        JE #{candidate.journal_entry_id} • Score {candidate.score_total}
      </div>
      <div style={{ fontSize: '0.8rem', color: '#475569' }}>
        {candidate.date} • {candidate.description}
      </div>
      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
        Ref {candidate.score_ref} · Date {candidate.score_date} · Desc {candidate.score_desc}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
        <Button
          variant="secondary"
          onClick={() => onReject(item.id, candidate)}
          isLoading={rejectingKey === key}
        >
          Reject
        </Button>
        <Button
          onClick={() => onReserveAndConfirm(item.id, candidate)}
          isLoading={reservingKey === key}
        >
          Reserve & Confirm
        </Button>
      </div>
    </div>
  )
}

function MatchQueueRow({
  item,
  candidates,
  scanningId,
  releasingId,
  rejectingKey,
  reservingKey,
  onScan,
  onReleaseReservation,
  onReject,
  onReserveAndConfirm,
}: {
  item: BankTransaction
  candidates: MatchCandidate[]
  scanningId: number | null
  releasingId: number | null
  rejectingKey: string | null
  reservingKey: string | null
  onScan: (id: number) => void
  onReleaseReservation: (id: number) => void
  onReject: (bankTransactionId: number, candidate: MatchCandidate) => void
  onReserveAndConfirm: (bankTransactionId: number, candidate: MatchCandidate) => void
}) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center' }}>
        <BankRowSummary item={item}>
          {item.suggested_match_id && (
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Suggested JE #{item.suggested_match_id}
            </div>
          )}
        </BankRowSummary>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            variant="secondary"
            onClick={() => onScan(item.id)}
            isLoading={scanningId === item.id}
          >
            Find Matches
          </Button>
          <Button
            variant="secondary"
            onClick={() => onReleaseReservation(item.id)}
            isLoading={releasingId === item.id}
          >
            Release
          </Button>
        </div>
      </div>

      {candidates.length > 0 && (
        <div style={{ marginTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {candidates.map((candidate) => (
            <MatchCandidateCard
              key={`${item.id}:${candidate.journal_entry_id}`}
              item={item}
              candidate={candidate}
              rejectingKey={rejectingKey}
              reservingKey={reservingKey}
              onReject={onReject}
              onReserveAndConfirm={onReserveAndConfirm}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function HeldRow({
  item,
  releaseHoldingId,
  onReleaseHold,
}: {
  item: BankTransaction
  releaseHoldingId: number | null
  onReleaseHold: (id: number) => void
}) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center' }}>
        <BankRowSummary item={item} />
        <Button
          onClick={() => onReleaseHold(item.id)}
          isLoading={releaseHoldingId === item.id}
        >
          Release
        </Button>
      </div>
    </div>
  )
}

function IgnoredRow({
  item,
  unignoringId,
  onUnignore,
}: {
  item: BankTransaction
  unignoringId: number | null
  onUnignore: (id: number) => void
}) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center' }}>
        <BankRowSummary item={item} />
        <Button
          onClick={() => onUnignore(item.id)}
          isLoading={unignoringId === item.id}
        >
          Restore
        </Button>
      </div>
    </div>
  )
}

function ReasonDialog({
  reasonTarget,
  reasonNote,
  isPending,
  onReasonNoteChange,
  onClose,
  onSubmit,
}: {
  reasonTarget: { id: number; action: ReasonAction }
  reasonNote: string
  isPending: boolean
  onReasonNoteChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={reasonTarget.action === 'hold' ? 'Move To Hold' : 'Ignore Row'}
      width='520px'
    >
      <div style={{ display: 'grid', gap: '1rem' }}>
        <Input
          label='Reason (optional)'
          value={reasonNote}
          onChange={(event) => onReasonNoteChange(event.target.value)}
          placeholder='Add context for the event log'
          maxLength={500}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            isLoading={isPending}
          >
            {reasonTarget.action === 'hold' ? 'Move To Hold' : 'Ignore'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function BankFeedMatchTab({ isActive }: { isActive: boolean }) {
  const state = useBankFeedMatchTab(isActive)

  return (
    <>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          {state.autoConfirmedCards.map((result) => (
            <AutoConfirmedMatchCard
              key={result.bankTransactionId}
              result={result}
              onDismiss={state.dismissAutoConfirmedCard}
            />
          ))}

          <SectionHeading>Pending Review ({state.pendingReviewItems.length})</SectionHeading>
          {state.pendingReviewItems.map((item) => (
            <PendingReviewRow
              key={`pending-${item.id}`}
              item={item}
              approvingId={state.approvingId}
              overridingId={state.overridingId}
              onApprove={state.handleApproveMatch}
              onOverride={state.handleOverrideMatch}
            />
          ))}

          <SectionHeading>Create Queue ({state.createItems.length})</SectionHeading>
          {state.createItems.map((item) => (
            <CreateQueueRow
              key={`create-${item.id}`}
              item={item}
              suggestions={state.billSuggestionsByRow[item.id] || []}
              payingBillKey={state.payingBillKey}
              holdingId={state.holdingId}
              ignoringId={state.ignoringId}
              onPayBill={state.handlePayBill}
              onHold={(id) => state.openReasonDialog(id, 'hold')}
              onIgnore={(id) => state.openReasonDialog(id, 'ignore')}
              onCreate={state.setCreateModalTarget}
            />
          ))}

          <SectionHeading>Match Queue ({state.matchQueueItems.length})</SectionHeading>
          {state.isLoadingMatchItems && (
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Loading match queue...</div>
          )}
          {!state.isLoadingMatchItems && state.matchQueueItems.length === 0 && (
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>No open items to match.</div>
          )}
          {state.matchQueueItems.map((item) => (
            <MatchQueueRow
              key={item.id}
              item={item}
              candidates={state.scanResults[item.id] || []}
              scanningId={state.scanningId}
              releasingId={state.releasingId}
              rejectingKey={state.rejectingKey}
              reservingKey={state.reservingKey}
              onScan={state.handleScan}
              onReleaseReservation={state.handleReleaseReservation}
              onReject={state.handleRejectCandidate}
              onReserveAndConfirm={state.handleReserveAndConfirm}
            />
          ))}

          <SectionHeading>Held ({state.heldItems.length})</SectionHeading>
          {state.heldItems.map((item) => (
            <HeldRow
              key={`hold-${item.id}`}
              item={item}
              releaseHoldingId={state.releaseHoldingId}
              onReleaseHold={state.handleReleaseHold}
            />
          ))}

          <SectionHeading>Ignored ({state.ignoredItems.length})</SectionHeading>
          {state.ignoredItems.map((item) => (
            <IgnoredRow
              key={`ignore-${item.id}`}
              item={item}
              unignoringId={state.unignoringId}
              onUnignore={state.handleUnignore}
            />
          ))}
        </div>
      </Card>

      {state.selectedCreateItem && (
        <CreateFromBankRowModal
          bankTransaction={state.selectedCreateItem}
          onClose={() => state.setCreateModalTarget(null)}
          onSuccess={() => state.addToast('Created new journal entry.', 'success')}
        />
      )}
      {state.reasonTarget && (
        <ReasonDialog
          reasonTarget={state.reasonTarget}
          reasonNote={state.reasonNote}
          isPending={state.holdMutation.isPending || state.ignoreMutation.isPending}
          onReasonNoteChange={state.setReasonNote}
          onClose={state.closeReasonDialog}
          onSubmit={state.submitReasonDialog}
        />
      )}
    </>
  )
}
