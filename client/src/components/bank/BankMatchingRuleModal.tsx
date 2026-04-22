import { useMemo, useState } from 'react'

import { useAccounts } from '../../api/useAccounts'
import {
  useCreateBankMatchingRule,
  useSimulateBankMatchingRule,
  useUpdateBankMatchingRule,
} from '../../api/useBankMatchingRules'
import { useContacts } from '../../api/useContacts'
import { useFunds } from '../../api/useFunds'
import { useTaxRates } from '../../api/useTaxRates'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Combobox from '../ui/Combobox'
import Input from '../ui/Input'
import Modal from '../ui/Modal'
import Select from '../ui/Select'
import { useToast } from '../ui/Toast'
import { getErrorMessage } from '../../utils/errors'
import type {
  BankMatchingRule,
  BankMatchingRuleDraft,
  BankMatchingRuleSplitDraft,
  BankRuleTransactionType,
} from '@shared/contracts'
import type { OptionValue, SelectOption } from '../ui/types'

interface BankMatchingRuleModalProps {
  rule?: BankMatchingRule
  onClose: () => void
}

interface SplitFormRow {
  id: string
  percentage: string
  fund_id: number | ''
  offset_account_id: number | ''
  expense_account_id: number | ''
  contact_id: number | ''
  tax_rate_id: number | ''
  memo: string
  description: string
}

interface FormState {
  name: string
  transaction_type: BankRuleTransactionType
  match_type: 'exact' | 'contains' | 'regex'
  match_pattern: string
  priority: string
  is_active: boolean
  bank_account_id: number | ''
  payee_id: number | ''
  offset_account_id: number | ''
  contact_id: number | ''
  useSplits: boolean
  splits: SplitFormRow[]
}

function makeSplitRow(source?: Partial<BankMatchingRuleSplitDraft & { id: number }>, index = 0): SplitFormRow {
  return {
    id: String(source?.id ?? `${Date.now()}-${index}`),
    percentage: source?.percentage != null ? String(source.percentage) : '',
    fund_id: source?.fund_id ?? '',
    offset_account_id: source?.offset_account_id ?? '',
    expense_account_id: source?.expense_account_id ?? '',
    contact_id: source?.contact_id ?? '',
    tax_rate_id: source?.tax_rate_id ?? '',
    memo: source?.memo ?? '',
    description: source?.description ?? '',
  }
}

function makeInitialState(rule?: BankMatchingRule): FormState {
  if (!rule) {
    return {
      name: '',
      transaction_type: 'deposit',
      match_type: 'contains',
      match_pattern: '',
      priority: '100',
      is_active: true,
      bank_account_id: '',
      payee_id: '',
      offset_account_id: '',
      contact_id: '',
      useSplits: false,
      splits: [],
    }
  }

  return {
    name: rule.name,
    transaction_type: rule.transaction_type,
    match_type: rule.match_type,
    match_pattern: rule.match_pattern,
    priority: String(rule.priority),
    is_active: rule.is_active,
    bank_account_id: rule.bank_account_id ?? '',
    payee_id: rule.payee_id ?? '',
    offset_account_id: rule.offset_account_id ?? '',
    contact_id: rule.contact_id ?? '',
    useSplits: rule.splits.length > 0,
    splits: rule.splits.map((split, index) => makeSplitRow(split, index)),
  }
}

function parseOptionalInt(value: OptionValue | '' | null | undefined) {
  if (value === '' || value === null || value === undefined) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function toRoundedPercent(value: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return NaN
  return Number(parsed.toFixed(4))
}

export default function BankMatchingRuleModal({
  rule,
  onClose,
}: BankMatchingRuleModalProps) {
  const { addToast } = useToast()
  const createRuleMutation = useCreateBankMatchingRule()
  const updateRuleMutation = useUpdateBankMatchingRule()
  const simulateRuleMutation = useSimulateBankMatchingRule()

  const { data: accounts = [] } = useAccounts({ include_inactive: true })
  const { data: funds = [] } = useFunds({ include_inactive: true })
  const { data: donorContacts = [] } = useContacts({ type: 'DONOR' })
  const { data: payeeContacts = [] } = useContacts({ type: 'PAYEE' })
  const { data: taxRates = [] } = useTaxRates({ activeOnly: true })

  const [form, setForm] = useState<FormState>(() => makeInitialState(rule))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [apiError, setApiError] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  const modeLabel = rule ? 'Edit Rule' : 'New Rule'
  const isSaving = createRuleMutation.isPending || updateRuleMutation.isPending

  const bankAccountOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'All accounts' },
      ...accounts
        .filter((account) => account.type === 'ASSET')
        .map((account) => ({ value: account.id, label: `${account.code} - ${account.name}` })),
    ],
    [accounts]
  )

  const offsetAccountOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'None' },
      ...accounts
        .filter((account) => account.is_active)
        .map((account) => ({ value: account.id, label: `${account.code} - ${account.name}` })),
    ],
    [accounts]
  )

  const expenseAccountOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'None' },
      ...accounts
        .filter((account) => account.is_active && account.type === 'EXPENSE')
        .map((account) => ({ value: account.id, label: `${account.code} - ${account.name}` })),
    ],
    [accounts]
  )

  const fundOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'Select fund' },
      ...funds
        .filter((fund) => fund.is_active)
        .map((fund) => ({ value: fund.id, label: fund.name })),
    ],
    [funds]
  )

  const payeeOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'None' },
      ...payeeContacts
        .filter((contact) => contact.is_active)
        .map((contact) => ({ value: contact.id, label: contact.name })),
    ],
    [payeeContacts]
  )

  const donorOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'None' },
      ...donorContacts
        .filter((contact) => contact.is_active)
        .map((contact) => ({ value: contact.id, label: contact.name })),
    ],
    [donorContacts]
  )

  const taxRateOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'None' },
      ...taxRates.map((rate) => ({ value: rate.id, label: `${rate.name} (${(rate.rate * 100).toFixed(2)}%)` })),
    ],
    [taxRates]
  )

  const splitPercentTotal = useMemo(
    () => form.splits.reduce((sum, split) => sum + (Number(split.percentage) || 0), 0),
    [form.splits]
  )
  const accountNameMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, `${account.code} - ${account.name}`])),
    [accounts]
  )
  const contactNameMap = useMemo(
    () => new Map(
      [...payeeContacts, ...donorContacts]
        .filter((contact) => contact.is_active)
        .map((contact) => [contact.id, contact.name])
    ),
    [payeeContacts, donorContacts]
  )

  function updateSplitRow(id: string, patch: Partial<SplitFormRow>) {
    setForm((prev) => ({
      ...prev,
      splits: prev.splits.map((split) => (split.id === id ? { ...split, ...patch } : split)),
    }))
  }

  function removeSplitRow(id: string) {
    setForm((prev) => ({
      ...prev,
      splits: prev.splits.filter((split) => split.id !== id),
    }))
  }

  function handleTransactionTypeChange(nextType: BankRuleTransactionType) {
    setForm((prev) => {
      if (prev.transaction_type === nextType) return prev
      if (nextType === 'withdrawal') {
        return {
          ...prev,
          transaction_type: nextType,
          contact_id: '',
          splits: prev.splits.map((split) => ({
            ...split,
            offset_account_id: '',
            contact_id: '',
          })),
        }
      }
      return {
        ...prev,
        transaction_type: nextType,
        payee_id: '',
        splits: prev.splits.map((split) => ({
          ...split,
          expense_account_id: '',
          tax_rate_id: '',
        })),
      }
    })
    setErrors({})
  }

  function handleUseSplitsChange(nextUseSplits: boolean) {
    setForm((prev) => {
      if (prev.useSplits === nextUseSplits) return prev
      if (nextUseSplits) {
        return {
          ...prev,
          useSplits: true,
          offset_account_id: '',
          contact_id: '',
          splits: prev.splits.length > 0 ? prev.splits : [makeSplitRow(undefined, 0)],
        }
      }
      return {
        ...prev,
        useSplits: false,
        splits: [],
      }
    })
    setErrors({})
  }

  function buildDraftFromForm(): BankMatchingRuleDraft {
    const priority = Number(form.priority)
    const baseDraft: BankMatchingRuleDraft = {
      name: form.name.trim(),
      transaction_type: form.transaction_type,
      match_type: form.match_type,
      match_pattern: form.match_pattern.trim(),
      priority: Number.isFinite(priority) ? Math.trunc(priority) : 100,
      is_active: form.is_active,
      bank_account_id: parseOptionalInt(form.bank_account_id),
    }

    if (form.transaction_type === 'withdrawal') {
      baseDraft.payee_id = parseOptionalInt(form.payee_id)
    }

    if (!form.useSplits) {
      baseDraft.offset_account_id = parseOptionalInt(form.offset_account_id)
      if (form.transaction_type === 'deposit') {
        baseDraft.contact_id = parseOptionalInt(form.contact_id)
      }
      return baseDraft
    }

    baseDraft.offset_account_id = undefined
    baseDraft.contact_id = undefined
    baseDraft.splits = form.splits.map((split) => {
      const draftSplit: BankMatchingRuleSplitDraft = {
        percentage: toRoundedPercent(split.percentage),
        fund_id: parseOptionalInt(split.fund_id) || 0,
        memo: split.memo.trim() || undefined,
        description: split.description.trim() || undefined,
      }
      if (form.transaction_type === 'deposit') {
        draftSplit.offset_account_id = parseOptionalInt(split.offset_account_id)
        draftSplit.contact_id = parseOptionalInt(split.contact_id)
      } else {
        draftSplit.expense_account_id = parseOptionalInt(split.expense_account_id)
        draftSplit.tax_rate_id = parseOptionalInt(split.tax_rate_id) ?? null
      }
      return draftSplit
    })
    return baseDraft
  }

  function validateForm() {
    const nextErrors: Record<string, string> = {}

    if (!form.name.trim()) nextErrors.name = 'Name is required'
    if (!form.match_pattern.trim()) nextErrors.match_pattern = 'Match pattern is required'
    if (form.match_type === 'regex') {
      try {
        // eslint-disable-next-line no-new
        new RegExp(form.match_pattern)
      } catch {
        nextErrors.match_pattern = 'Invalid regular expression'
      }
    }

    if (form.transaction_type === 'withdrawal' && !parseOptionalInt(form.payee_id)) {
      nextErrors.payee_id = 'Payee is required'
    }

    if (!form.useSplits) {
      if (!parseOptionalInt(form.offset_account_id)) {
        nextErrors.offset_account_id = 'Offset account is required'
      }
      setErrors(nextErrors)
      return Object.keys(nextErrors).length === 0
    }

    if (form.splits.length === 0) {
      nextErrors.splits = 'At least one split row is required'
    }

    let splitSum = 0
    form.splits.forEach((split, index) => {
      const percentage = Number(split.percentage)
      const prefix = `split_${index}`
      if (!Number.isFinite(percentage) || percentage <= 0) {
        nextErrors[`${prefix}_percentage`] = 'Each split percentage must be greater than 0'
      } else {
        splitSum += percentage
      }

      if (!parseOptionalInt(split.fund_id)) {
        nextErrors[`${prefix}_fund_id`] = 'Fund is required on each split'
      }

      if (form.transaction_type === 'deposit' && !parseOptionalInt(split.offset_account_id)) {
        nextErrors[`${prefix}_offset_account_id`] = 'Offset account is required for deposit splits'
      }

      if (form.transaction_type === 'withdrawal' && !parseOptionalInt(split.expense_account_id)) {
        nextErrors[`${prefix}_expense_account_id`] = 'Expense account is required for withdrawal splits'
      }
    })

    if (Math.abs(splitSum - 100) > 0.0001) {
      nextErrors.splits_total = 'Split percentages must total exactly 100.00'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSave() {
    setApiError('')
    if (!validateForm()) return

    const draft = buildDraftFromForm()
    try {
      if (rule) {
        await updateRuleMutation.mutateAsync({ id: rule.id, payload: draft })
        addToast('Rule updated.', 'success')
      } else {
        await createRuleMutation.mutateAsync(draft)
        addToast('Rule created.', 'success')
      }
      onClose()
    } catch (err) {
      setApiError(getErrorMessage(err, 'Failed to save rule.'))
    }
  }

  async function handlePreview() {
    setApiError('')
    const nextErrors = { ...errors }
    delete nextErrors.match_pattern
    if (!form.match_pattern.trim()) {
      nextErrors.match_pattern = 'Match pattern is required'
      setErrors(nextErrors)
      return
    }
    if (form.match_type === 'regex') {
      try {
        // eslint-disable-next-line no-new
        new RegExp(form.match_pattern)
      } catch {
        nextErrors.match_pattern = 'Invalid regular expression'
        setErrors(nextErrors)
        return
      }
    }
    setErrors(nextErrors)

    const draft = buildDraftFromForm()
    try {
      await simulateRuleMutation.mutateAsync({
        rule: draft,
        exclude_rule_id: rule?.id,
        filters: { limit: 20 },
      })
      setShowPreview(true)
    } catch (err) {
      setApiError(getErrorMessage(err, 'Failed to preview rule.'))
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={modeLabel}
      width="820px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <Input
            label="Name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            error={errors.name}
            required
          />
          <Input
            label="Priority"
            type="number"
            value={form.priority}
            onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
          />
          <Select
            label="Transaction Type"
            value={form.transaction_type}
            options={[
              { value: 'deposit', label: 'deposit' },
              { value: 'withdrawal', label: 'withdrawal' },
            ]}
            onChange={(event) => handleTransactionTypeChange(event.target.value as BankRuleTransactionType)}
          />
          <Select
            label="Match Type"
            value={form.match_type}
            options={[
              { value: 'exact', label: 'exact' },
              { value: 'contains', label: 'contains' },
              { value: 'regex', label: 'regex' },
            ]}
            onChange={(event) => setForm((prev) => ({ ...prev, match_type: event.target.value as FormState['match_type'] }))}
          />
          <Input
            label="Match Pattern"
            value={form.match_pattern}
            onChange={(event) => setForm((prev) => ({ ...prev, match_pattern: event.target.value }))}
            error={errors.match_pattern}
            required
          />
          <Combobox
            label="Bank Account Scope"
            value={form.bank_account_id}
            onChange={(value) => setForm((prev) => ({ ...prev, bank_account_id: (value || '') as number | '' }))}
            options={bankAccountOptions}
            placeholder="All accounts"
          />
        </div>

        {form.match_type === 'regex' && (
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Regex syntax is validated before preview/save.
          </div>
        )}

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem', color: '#334155' }}>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
          />
          Active
        </label>

        {form.transaction_type === 'withdrawal' && (
          <Combobox
            label="Payee"
            value={form.payee_id}
            onChange={(value) => setForm((prev) => ({ ...prev, payee_id: (value || '') as number | '' }))}
            options={payeeOptions}
            placeholder="Select payee"
            error={errors.payee_id}
            required
          />
        )}

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem', color: '#334155' }}>
          <input
            type="checkbox"
            checked={form.useSplits}
            onChange={(event) => handleUseSplitsChange(event.target.checked)}
          />
          Use splits
        </label>

        {!form.useSplits && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Combobox
              label="Offset Account"
              value={form.offset_account_id}
              onChange={(value) => setForm((prev) => ({ ...prev, offset_account_id: (value || '') as number | '' }))}
              options={offsetAccountOptions}
              placeholder="Select offset account"
              error={errors.offset_account_id}
              required
            />
            {form.transaction_type === 'deposit' && (
              <Combobox
                label="Contact"
                value={form.contact_id}
                onChange={(value) => setForm((prev) => ({ ...prev, contact_id: (value || '') as number | '' }))}
                options={donorOptions}
                placeholder="None"
              />
            )}
          </div>
        )}

        {form.useSplits && (
          <Card style={{ padding: '0.9rem 1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {errors.splits && <div style={{ color: '#b91c1c', fontSize: '0.8rem' }}>{errors.splits}</div>}
              {form.splits.map((split, index) => {
                const prefix = `split_${index}`
                return (
                  <div key={split.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.65rem' }}>
                      <Input
                        label="%"
                        type="number"
                        value={split.percentage}
                        onChange={(event) => updateSplitRow(split.id, { percentage: event.target.value })}
                        error={errors[`${prefix}_percentage`]}
                      />
                      <Combobox
                        label="Fund"
                        value={split.fund_id}
                        onChange={(value) => updateSplitRow(split.id, { fund_id: (value || '') as number | '' })}
                        options={fundOptions}
                        placeholder="Select fund"
                        error={errors[`${prefix}_fund_id`]}
                      />
                      {form.transaction_type === 'deposit' ? (
                        <Combobox
                          label="Offset Account"
                          value={split.offset_account_id}
                          onChange={(value) => updateSplitRow(split.id, { offset_account_id: (value || '') as number | '' })}
                          options={offsetAccountOptions}
                          placeholder="Select offset account"
                          error={errors[`${prefix}_offset_account_id`]}
                        />
                      ) : (
                        <Combobox
                          label="Expense Account"
                          value={split.expense_account_id}
                          onChange={(value) => updateSplitRow(split.id, { expense_account_id: (value || '') as number | '' })}
                          options={expenseAccountOptions}
                          placeholder="Select expense account"
                          error={errors[`${prefix}_expense_account_id`]}
                        />
                      )}
                      {form.transaction_type === 'deposit' && (
                        <Combobox
                          label="Contact"
                          value={split.contact_id}
                          onChange={(value) => updateSplitRow(split.id, { contact_id: (value || '') as number | '' })}
                          options={donorOptions}
                          placeholder="None"
                        />
                      )}
                      {form.transaction_type === 'withdrawal' && (
                        <Combobox
                          label="Tax Rate"
                          value={split.tax_rate_id}
                          onChange={(value) => updateSplitRow(split.id, { tax_rate_id: (value || '') as number | '' })}
                          options={taxRateOptions}
                          placeholder="None"
                        />
                      )}
                      <Input
                        label="Memo"
                        value={split.memo}
                        onChange={(event) => updateSplitRow(split.id, { memo: event.target.value })}
                        placeholder="Optional"
                      />
                      <Input
                        label="Description"
                        value={split.description}
                        onChange={(event) => updateSplitRow(split.id, { description: event.target.value })}
                        placeholder="Optional"
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.65rem' }}>
                      <Button size="sm" variant="ghost" onClick={() => removeSplitRow(split.id)}>
                        Remove row
                      </Button>
                    </div>
                  </div>
                )
              })}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setForm((prev) => ({ ...prev, splits: [...prev.splits, makeSplitRow(undefined, prev.splits.length)] }))}
                >
                  Add split row
                </Button>
                <span style={{ fontSize: '0.82rem', color: errors.splits_total ? '#b91c1c' : '#334155' }}>
                  Total: {splitPercentTotal.toFixed(2)}%
                </span>
              </div>
              {errors.splits_total && (
                <div style={{ color: '#b91c1c', fontSize: '0.8rem' }}>{errors.splits_total}</div>
              )}
            </div>
          </Card>
        )}

        <Card style={{ padding: '0.9rem 1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b' }}>Preview Rule Matches</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button size="sm" variant="secondary" disabled={!form.match_pattern.trim()} onClick={() => void handlePreview()}>
                  Run Preview
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowPreview((prev) => !prev)}>
                  {showPreview ? 'Hide' : 'Show'}
                </Button>
              </div>
            </div>

            {showPreview && simulateRuleMutation.isPending && (
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Loading preview...</div>
            )}

            {showPreview && !simulateRuleMutation.isPending && simulateRuleMutation.data && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                {simulateRuleMutation.data.matches.length === 0 && (
                  <div style={{ fontSize: '0.84rem', color: '#64748b' }}>
                    No matches found in the sampled recent transactions.
                  </div>
                )}

                {simulateRuleMutation.data.matches.slice(0, 5).map((match) => (
                  <div key={match.bank_transaction_id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.65rem' }}>
                    <div style={{ fontSize: '0.83rem', color: '#334155' }}>
                      {match.bank_posted_date} | {match.raw_description} | {match.amount.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                      Proposal: account {accountNameMap.get(match.create_proposal.offset_account_id || 0) || '-'}, payee {contactNameMap.get(match.create_proposal.payee_id || 0) || '-'}, contact {contactNameMap.get(match.create_proposal.contact_id || 0) || '-'}, splits {(match.create_proposal.splits || []).length}
                    </div>
                  </div>
                ))}

                {simulateRuleMutation.data.conflicts.length > 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.7rem' }}>
                    <div style={{ fontSize: '0.82rem', color: '#92400e', marginBottom: '0.35rem' }}>
                      This pattern overlaps with an existing active rule. The engine evaluates rules by specificity (exact → contains → regex), then priority, then ID.
                    </div>
                    {simulateRuleMutation.data.conflicts.map((conflict) => (
                      <div key={`${conflict.rule_id}-${conflict.match_pattern}`} style={{ fontSize: '0.8rem', color: '#78350f' }}>
                        {conflict.rule_name} ({conflict.match_type}: "{conflict.match_pattern}")
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {apiError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.65rem', color: '#b91c1c', fontSize: '0.82rem' }}>
            {apiError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Button variant="secondary" disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
          <Button isLoading={isSaving} onClick={() => void handleSave()}>
            Save Rule
          </Button>
        </div>
      </div>
    </Modal>
  )
}
