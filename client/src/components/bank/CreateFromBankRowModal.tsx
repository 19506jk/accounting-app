import { useMemo, useState } from 'react'

import { useAccounts } from '../../api/useAccounts'
import { useCreateFromBankRow } from '../../api/useBankTransactions'
import { useContacts } from '../../api/useContacts'
import { useFunds } from '../../api/useFunds'
import Button from '../ui/Button'
import Combobox from '../ui/Combobox'
import Input from '../ui/Input'
import Modal from '../ui/Modal'
import SplitTransactionModal from '../../pages/importCsv/SplitTransactionModal'
import { getErrorMessage } from '../../utils/errors'
import type { BankTransaction, CreateFromBankRowInput } from '@shared/contracts'
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
  const { data: accounts = [] } = useAccounts()
  const { data: funds = [] } = useFunds()
  const { data: donorContacts = [] } = useContacts({ type: 'DONOR' })
  const { data: payeeContacts = [] } = useContacts({ type: 'PAYEE' })

  const [error, setError] = useState('')
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [row, setRow] = useState<ParsedImportRow>({
    date: bankTransaction.bank_posted_date,
    description: bankTransaction.raw_description,
    reference_no: bankTransaction.bank_transaction_id || undefined,
    amount: Math.abs(bankTransaction.amount),
    type: bankTransaction.amount >= 0 ? 'deposit' : 'withdrawal',
    offset_account_id: undefined,
    payee_id: undefined,
    contact_id: undefined,
    splits: undefined,
  })

  const activeAccounts = useMemo(() => accounts.filter((a) => a.is_active), [accounts])
  const activeFunds = useMemo(() => funds.filter((f) => f.is_active), [funds])
  const defaultFundId = bankTransaction.fund_id

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

  function handleSplitSave(payload: SplitSavePayload) {
    const splitPayload = Array.isArray(payload) ? { splits: payload } : payload
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
    setRow((prev) => ({
      ...prev,
      splits: undefined,
      payee_id: undefined,
    }))
  }

  async function handleSubmit() {
    setError('')
    const payload: CreateFromBankRowInput = {
      date: row.date,
      description: row.description,
      reference_no: row.reference_no || undefined,
      amount: row.amount,
      type: row.type,
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
                onChange={(value) => setRow((prev) => ({ ...prev, offset_account_id: Number(value) || undefined }))}
                options={offsetAccountOptions}
                placeholder="Select offset account"
              />
              {row.type === 'deposit' ? (
                <Combobox
                  label="Contact"
                  value={row.contact_id || ''}
                  onChange={(value) => setRow((prev) => ({ ...prev, contact_id: Number(value) || undefined }))}
                  options={donorOptions}
                  placeholder="Optional contact"
                />
              ) : (
                <Combobox
                  label="Payee"
                  value={row.payee_id || ''}
                  onChange={(value) => setRow((prev) => ({ ...prev, payee_id: Number(value) || undefined }))}
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
