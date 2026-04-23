import { useEffect, useMemo, useRef, useState } from 'react'

import { useAccounts } from '../../api/useAccounts'
import { useSimulateBankMatchingRule } from '../../api/useBankMatchingRules'
import { useCreateFromBankRow } from '../../api/useBankTransactions'
import { useContacts } from '../../api/useContacts'
import { useFunds } from '../../api/useFunds'
import { useSettings } from '../../api/useSettings'
import Button from '../ui/Button'
import Combobox from '../ui/Combobox'
import Input from '../ui/Input'
import Modal from '../ui/Modal'
import SplitTransactionModal from '../../pages/importCsv/SplitTransactionModal'
import { getErrorMessage } from '../../utils/errors'
import { buildTrainFromFeedDraft, extractTrainPattern } from '../../utils/trainFromFeed'
import {
  buildDonorIndexes,
  isInteracEtransferPaymentMethod,
  isEtransferDescription,
  matchDonorFromSender,
} from '../../utils/etransferEnrich'
import type { BankTransaction, CreateFromBankRowInput, SimulateBankMatchingRuleResult } from '@shared/contracts'
import type { ParsedImportRow, SplitSavePayload } from '../../pages/importCsv/importCsvTypes'
import type { SelectOption } from '../ui/types'

interface CreateFromBankRowModalProps {
  bankTransaction: BankTransaction
  onClose: () => void
  onSuccess: () => void
}

export default function CreateFromBankRowModal({
  bankTransaction,
  onClose,
  onSuccess,
}: CreateFromBankRowModalProps) {
  const createMutation = useCreateFromBankRow()
  const simulateMutation = useSimulateBankMatchingRule()
  const { data: accounts = [] } = useAccounts()
  const { data: funds = [] } = useFunds()
  const { data: settings } = useSettings()
  const { data: donorContacts = [] } = useContacts({ type: 'DONOR' })
  const { data: payeeContacts = [] } = useContacts({ type: 'PAYEE' })

  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [trainFromFeed, setTrainFromFeed] = useState(false)
  const proposal = bankTransaction.create_proposal
  const fallbackDescription = [bankTransaction.raw_description, bankTransaction.bank_description_2].filter(Boolean).join(' — ')
  const fallbackEtransferDescription = [bankTransaction.raw_description, bankTransaction.bank_description_2].filter(Boolean).join(' — ')
  const isEtransferDeposit = useMemo(() => {
    if (bankTransaction.amount < 0) return false
    if (isInteracEtransferPaymentMethod(bankTransaction.payment_method)) return true
    return isEtransferDescription(fallbackEtransferDescription)
  }, [bankTransaction.amount, bankTransaction.payment_method, fallbackEtransferDescription])
  const [row, setRow] = useState<ParsedImportRow>({
    date: bankTransaction.bank_posted_date,
    description: proposal?.description || fallbackDescription,
    reference_no: proposal?.reference_no || bankTransaction.bank_transaction_id || undefined,
    amount: Math.abs(bankTransaction.amount),
    type: bankTransaction.amount >= 0 ? 'deposit' : 'withdrawal',
    offset_account_id: proposal?.offset_account_id,
    payee_id: proposal?.payee_id,
    contact_id: proposal?.contact_id,
    splits: proposal?.splits?.map((split) => ({ ...split })),
  })

  const activeAccounts = useMemo(() => accounts.filter((a) => a.is_active), [accounts])
  const activeFunds = useMemo(() => funds.filter((f) => f.is_active), [funds])
  const etransferOffsetId = useMemo(() => {
    const raw = settings?.etransfer_deposit_offset_account_id
    return raw ? Number(raw) : 0
  }, [settings])
  const donorIndexes = useMemo(
    () => buildDonorIndexes(donorContacts.filter((c) => c.is_active)),
    [donorContacts]
  )
  const defaultFundId = bankTransaction.fund_id
  const offsetEnriched = useRef(false)
  const donorEnriched = useRef(false)

  useEffect(() => {
    if (offsetEnriched.current || !settings) return
    offsetEnriched.current = true

    if (!isEtransferDeposit) return
    if (!etransferOffsetId) return

    setRow((prev) => (
      prev.offset_account_id ? prev : { ...prev, offset_account_id: etransferOffsetId }
    ))
  }, [settings, etransferOffsetId, isEtransferDeposit])

  useEffect(() => {
    if (donorEnriched.current || donorContacts.length === 0) return
    donorEnriched.current = true

    if (!isEtransferDeposit) return

    const matchedId = matchDonorFromSender(
      bankTransaction.sender_email,
      bankTransaction.sender_name,
      donorIndexes
    )
    if (!matchedId) return

    setRow((prev) => (
      prev.contact_id ? prev : { ...prev, contact_id: matchedId }
    ))
  }, [donorContacts, bankTransaction, donorIndexes, isEtransferDeposit])

  const offsetAccountOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'Select offset account' },
      ...activeAccounts
        .filter((a) => a.id !== bankTransaction.account_id)
        .map((a) => ({ value: a.id, label: `${a.code} - ${a.name}` })),
    ],
    [activeAccounts, bankTransaction.account_id]
  )

  const expenseAccountOptions = useMemo<SelectOption[]>(
    () => activeAccounts
      .filter((a) => a.type === 'EXPENSE')
      .map((a) => ({ value: a.id, label: `${a.code} - ${a.name}` })),
    [activeAccounts]
  )

  const activeExpenseAccountIds = useMemo(
    () => activeAccounts.filter((a) => a.type === 'EXPENSE').map((a) => a.id),
    [activeAccounts]
  )
  const accountNameMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, `${account.code} - ${account.name}`])),
    [accounts]
  )
  const contactNameMap = useMemo(() => {
    const map = new Map<number, string>()
    donorContacts.forEach((contact) => map.set(contact.id, contact.name))
    payeeContacts.forEach((contact) => map.set(contact.id, contact.name))
    return map
  }, [donorContacts, payeeContacts])
  const trainPattern = useMemo(
    () => extractTrainPattern(bankTransaction),
    [bankTransaction]
  )

  const fundOptions = useMemo<SelectOption[]>(
    () => activeFunds.map((f) => ({ value: f.id, label: f.name })),
    [activeFunds]
  )

  const donorOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'None' },
      ...donorContacts.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })),
    ],
    [donorContacts]
  )

  const payeeOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'None' },
      ...payeeContacts.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })),
    ],
    [payeeContacts]
  )

  const hasSplits = (row.splits?.length || 0) > 0

  function resetPreview() {
    setPreviewError('')
    simulateMutation.reset()
  }

  function handleSplitSave(payload: SplitSavePayload) {
    const splitPayload = Array.isArray(payload) ? { splits: payload } : payload
    resetPreview()
    setRow((prev) => ({
      ...prev,
      splits: splitPayload.splits,
      payee_id: 'payee_id' in splitPayload ? splitPayload.payee_id || undefined : undefined,
      offset_account_id: undefined,
      contact_id: undefined,
    }))
    setSplitModalOpen(false)
  }

  function clearSplits() {
    resetPreview()
    setRow((prev) => ({
      ...prev,
      splits: undefined,
      payee_id: undefined,
    }))
  }

  async function handlePreview() {
    setPreviewError('')
    const { draft, error: draftError } = buildTrainFromFeedDraft(bankTransaction, row)
    if (!draft) {
      simulateMutation.reset()
      setPreviewError(draftError || 'Preview failed.')
      return
    }

    try {
      await simulateMutation.mutateAsync({ rule: draft, filters: { limit: 20 } })
    } catch (err) {
      setPreviewError(getErrorMessage(err, 'Preview failed.'))
    }
  }

  async function handleSubmit() {
    setError('')
    const payload: CreateFromBankRowInput = {
      date: row.date,
      description: row.description,
      reference_no: row.reference_no || undefined,
      amount: row.amount,
      type: row.type,
      train_from_feed: trainFromFeed,
      offset_account_id: hasSplits ? undefined : (row.offset_account_id ? Number(row.offset_account_id) : undefined),
      payee_id: row.payee_id ? Number(row.payee_id) : undefined,
      contact_id: row.contact_id ? Number(row.contact_id) : undefined,
      splits: row.splits,
    }

    try {
      await createMutation.mutateAsync({
        id: bankTransaction.id,
        payload,
      })
      onSuccess()
      onClose()
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create journal entry from bank row.'))
    }
  }

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title={`Create Journal Entry - Bank Row #${bankTransaction.id}`}
        width="760px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Input label="Date" value={row.date} disabled />
            <Input label="Amount" value={row.amount.toFixed(2)} disabled />
          </div>
          <Input label="Description" value={row.description} disabled />
          <Input
            label="Reference Number"
            value={row.reference_no || ''}
            onChange={(event) => setRow((prev) => ({ ...prev, reference_no: event.target.value }))}
            placeholder="Optional"
          />

          {!hasSplits && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Combobox
                label="Offset Account"
                value={row.offset_account_id || ''}
                onChange={(value) => {
                  resetPreview()
                  setRow((prev) => ({ ...prev, offset_account_id: Number(value) || undefined }))
                }}
                options={offsetAccountOptions}
                placeholder="Select offset account"
              />
              {row.type === 'deposit' ? (
                <Combobox
                  label="Contact"
                  value={row.contact_id || ''}
                  onChange={(value) => {
                    resetPreview()
                    setRow((prev) => ({ ...prev, contact_id: Number(value) || undefined }))
                  }}
                  options={donorOptions}
                  placeholder="Optional contact"
                />
              ) : (
                <Combobox
                  label="Payee"
                  value={row.payee_id || ''}
                  onChange={(value) => {
                    resetPreview()
                    setRow((prev) => ({ ...prev, payee_id: Number(value) || undefined }))
                  }}
                  options={payeeOptions}
                  placeholder="Optional payee"
                />
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ fontSize: '0.82rem', color: '#475569' }}>
              {hasSplits ? `${row.splits?.length || 0} split line(s) configured` : 'No splits configured'}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {hasSplits && (
                <Button variant="secondary" onClick={clearSplits}>
                  Clear Splits
                </Button>
              )}
              <Button variant="secondary" onClick={() => setSplitModalOpen(true)}>
                {hasSplits ? 'Edit Splits' : 'Configure Splits'}
              </Button>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: '#334155' }}>
            <input
              type="checkbox"
              checked={trainFromFeed}
              onChange={(event) => {
                const checked = event.target.checked
                if (!checked) {
                  resetPreview()
                }
                setTrainFromFeed(checked)
              }}
            />
            Always treat transactions like this as this account/fund setup
          </label>

          {trainFromFeed && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                Pattern to match:{' '}
                <code style={{ background: '#e2e8f0', borderRadius: '4px', padding: '0.1rem 0.35rem' }}>
                  {trainPattern || '(empty - no pattern extracted)'}
                </code>
              </div>
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  isLoading={simulateMutation.isPending}
                  disabled={!trainPattern || simulateMutation.isPending}
                  onClick={() => void handlePreview()}
                >
                  Preview matches
                </Button>
              </div>
              {previewError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.65rem', color: '#b91c1c', fontSize: '0.82rem' }}>
                  {previewError}
                </div>
              )}
              {simulateMutation.data && (
                <TrainPreviewResults
                  result={simulateMutation.data}
                  accountNameMap={accountNameMap}
                  contactNameMap={contactNameMap}
                />
              )}
            </div>
          )}

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.65rem', color: '#b91c1c', fontSize: '0.82rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} isLoading={createMutation.isPending}>Create Journal Entry</Button>
          </div>
        </div>
      </Modal>

      <SplitTransactionModal
        isOpen={splitModalOpen}
        onClose={() => setSplitModalOpen(false)}
        onSave={handleSplitSave}
        row={row}
        defaultFundId={defaultFundId}
        offsetAccountOptions={offsetAccountOptions}
        fundOptions={fundOptions}
        donorOptions={donorOptions}
        payeeOptions={payeeOptions}
        expenseAccountOptions={expenseAccountOptions}
        activeExpenseAccountIds={activeExpenseAccountIds}
      />
    </>
  )
}

interface TrainPreviewResultsProps {
  result: SimulateBankMatchingRuleResult
  accountNameMap: Map<number, string>
  contactNameMap: Map<number, string>
}

function TrainPreviewResults({ result, accountNameMap, contactNameMap }: TrainPreviewResultsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      {result.matches.length === 0 && (
        <div style={{ fontSize: '0.84rem', color: '#64748b' }}>
          No matches found in the sampled recent transactions.
        </div>
      )}

      {result.matches.slice(0, 5).map((match) => (
        <div key={match.bank_transaction_id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.65rem' }}>
          <div style={{ fontSize: '0.83rem', color: '#334155' }}>
            {match.bank_posted_date} | {match.raw_description} | {match.amount.toFixed(2)}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
            Proposal: account {accountNameMap.get(match.create_proposal.offset_account_id || 0) || '-'}, payee {contactNameMap.get(match.create_proposal.payee_id || 0) || '-'}, contact {contactNameMap.get(match.create_proposal.contact_id || 0) || '-'}, splits {(match.create_proposal.splits || []).length}
          </div>
        </div>
      ))}

      {result.conflicts.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.7rem' }}>
          <div style={{ fontSize: '0.82rem', color: '#92400e', marginBottom: '0.35rem' }}>
            This pattern overlaps with an existing active rule. Rules are evaluated by specificity (exact {'->'} contains {'->'} regex), then priority, then ID.
          </div>
          {result.conflicts.map((conflict) => (
            <div key={`${conflict.rule_id}-${conflict.match_pattern}`} style={{ fontSize: '0.8rem', color: '#78350f' }}>
              {conflict.rule_name} ({conflict.match_type}: "{conflict.match_pattern}")
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
