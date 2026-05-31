import type { SelectOption } from '../components/ui/types'

export const PAYMENT_METHOD_OPTIONS: SelectOption[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'e-transfer', label: 'E-Transfer' },
]

export const PAYMENT_METHOD_OPTIONS_WITH_EMPTY: SelectOption[] = [
  { value: '', label: '—' },
  ...PAYMENT_METHOD_OPTIONS,
]
