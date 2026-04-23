import type { AccountClass, AccountType, NormalBalanceSide, Role } from '@shared/contracts';

export interface UserRow {
  id: number;
  google_id: string | null;
  email: string;
  name: string;
  avatar_url: string | null;
  role: Role;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface FundRow {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  net_asset_account_id: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AccountRow {
  id: number;
  code: string;
  name: string;
  type: AccountType | string;
  account_class: AccountClass | string;
  normal_balance: NormalBalanceSide | null;
  parent_id?: number | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface TransactionRow {
  id: number;
  date: Date | string;
  description: string;
  reference_no: string | null;
  fund_id: number;
  is_voided: boolean;
  is_closing_entry: boolean;
  created_by: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface JournalEntryRow {
  id: number;
  transaction_id: number;
  account_id: number;
  fund_id: number;
  contact_id: number | null;
  debit: string | number;
  credit: string | number;
  memo: string | null;
  is_reconciled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ReconciliationRow {
  id: number;
  account_id: number;
  statement_date: Date | string;
  statement_balance: string | number;
  opening_balance: string | number;
  is_closed: boolean;
  created_by: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface RecItemRow {
  id: number;
  reconciliation_id: number;
  journal_entry_id: number;
  is_cleared: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AccountListRow {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  account_class: AccountClass;
  normal_balance: NormalBalanceSide | null;
  parent_id: number | null;
  is_active: boolean;
  journal_entry_count: string | number;
  is_deletable: boolean;
}

export interface TransactionListRow {
  id: number;
  date: Date | string;
  description: string;
  reference_no: string | null;
  contact_name: string | null;
  has_multiple_contacts: boolean | number;
  fund_id: number;
  created_at: Date | string;
  created_by_name: string | null;
  total_amount: string | number;
  is_voided: boolean | null;
}

export interface TransactionEntryDetailRow {
  id: number;
  account_id: number;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  fund_id: number;
  fund_name: string;
  debit: string | number;
  credit: string | number;
  memo: string | null;
  is_reconciled: boolean;
  contact_id: number | null;
  contact_name: string | null;
}

export interface ReconciliationSummaryRow {
  id: number;
  account_id: number;
  account_name: string;
  account_code: string;
  statement_date: Date | string;
  statement_balance: string | number;
  opening_balance: string | number;
  is_closed: boolean;
  created_at: Date | string;
  created_by_name: string | null;
}

export interface ReconciliationDetailRow extends ReconciliationSummaryRow {
  account_type: AccountType;
}

export interface ReconciliationItemRow {
  id: number;
  journal_entry_id: number;
  is_cleared: boolean;
  date: Date | string;
  description: string;
  reference_no: string | null;
  fund_name: string;
  debit: string | number;
  credit: string | number;
}

export interface ContactRow {
  id: number;
  type: 'DONOR' | 'PAYEE' | 'BOTH';
  contact_class: 'INDIVIDUAL' | 'HOUSEHOLD';
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  notes: string | null;
  donor_id: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ContactDonationRow {
  transaction_id: number;
  date: Date | string;
  description: string;
  reference_no: string | null;
  account_name: string;
  account_code: string;
  fund_name: string;
  amount: string | number;
  memo: string | null;
}

export interface ContactDonationSummaryRow {
  year: number;
  total: string | number;
  donation_count: string | number;
}

export interface BillRow {
  id: number;
  contact_id: number;
  date: Date | string;
  due_date: Date | string | null;
  bill_number: string | null;
  description: string;
  amount: string | number;
  fund_id: number;
  amount_paid: string | number;
  status: 'UNPAID' | 'PAID' | 'VOID';
  transaction_id: number | null;
  created_transaction_id: number | null;
  created_by: number;
  paid_by: number | null;
  paid_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface BillListRow extends BillRow {
  vendor_name: string | null;
  fund_name: string | null;
  created_by_name: string | null;
  is_voided: boolean | null;
}

export interface BillLineItemRow {
  id: number;
  bill_id: number;
  expense_account_id: number;
  amount: string | number;
  rounding_adjustment: string | number;
  description: string | null;
  tax_rate_id: number | null;
}

export interface BillCreditApplicationRow {
  id: number;
  target_bill_id: number;
  credit_bill_id: number;
  amount: string | number;
  apply_transaction_id: number | null;
  applied_by: number;
  applied_at: Date | string;
  unapplied_by: number | null;
  unapplied_at: Date | string | null;
}

export interface BankUploadRow {
  id: number;
  account_id: number;
  fund_id: number;
  uploaded_by: number | null;
  filename: string;
  row_count: number;
  imported_at: Date | string;
}

export type BankTransactionStatusRow =
  | 'imported'
  | 'needs_review'
  | 'matched_existing'
  | 'created_new'
  | 'locked'
  | 'archived';

export type BankLifecycleStatusRow = 'open' | 'locked' | 'archived';
export type BankMatchStatusRow = 'none' | 'suggested' | 'confirmed' | 'rejected';
export type BankCreationStatusRow = 'none' | 'suggested_create' | 'created';
export type BankReviewStatusRow = 'pending' | 'reviewed';
export type BankMatchSourceRow = 'system' | 'human';
export type BankCreationSourceRow = 'human';
export type BankDispositionRow = 'none' | 'hold' | 'ignored';
export type BankRuleTransactionTypeRow = 'deposit' | 'withdrawal';
export type BankRuleMatchTypeRow = 'exact' | 'contains' | 'regex';

export interface BankTransactionRow {
  id: number;
  upload_id: number;
  row_index: number;
  bank_transaction_id: string | null;
  bank_posted_date: Date | string;
  bank_effective_date: Date | string | null;
  raw_description: string;
  sender_name: string | null;
  sender_email: string | null;
  bank_description_2: string | null;
  payment_method: string | null;
  normalized_description: string;
  amount: string | number;
  fingerprint: string;
  status: BankTransactionStatusRow;
  journal_entry_id: number | null;
  reviewed_by: number | null;
  reviewed_at: Date | string | null;
  review_decision: 'confirmed_new' | 'mark_as_duplicate' | null;
  imported_at: Date | string;
  last_modified_at: Date | string;
  lifecycle_status: BankLifecycleStatusRow;
  match_status: BankMatchStatusRow;
  creation_status: BankCreationStatusRow;
  review_status: BankReviewStatusRow;
  match_source: BankMatchSourceRow | null;
  creation_source: BankCreationSourceRow | null;
  suggested_match_id: number | null;
  matched_journal_entry_id: number | null;
  disposition: BankDispositionRow;
  create_proposal: unknown | null;
  create_proposal_rule_id: number | null;
  create_proposal_rule_name: string | null;
  create_proposal_created_at: Date | string | null;
}

export interface ReconciliationReservationRow {
  id: number;
  journal_entry_id: number;
  bank_transaction_id: number;
  reserved_by: number | null;
  reserved_at: Date | string;
  expires_at: Date | string;
}

export interface BankTransactionEventRow {
  id: number;
  bank_transaction_id: number | null;
  event_type: string;
  actor_type: 'user' | 'system' | 'admin';
  actor_id: number | null;
  payload: string | null;
  reason_note: string | null;
  created_at: Date | string;
}

export interface BankTransactionRejectionRow {
  id: number;
  bank_transaction_id: number;
  journal_entry_id: number;
  rejected_by: number | null;
  rejected_at: Date | string;
}

export interface BankMatchingRuleRow {
  id: number;
  name: string;
  priority: number;
  transaction_type: BankRuleTransactionTypeRow;
  match_type: BankRuleMatchTypeRow;
  match_pattern: string;
  bank_account_id: number | null;
  offset_account_id: number | null;
  payee_id: number | null;
  contact_id: number | null;
  is_active: boolean;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface BankMatchingRuleSplitRow {
  id: number;
  rule_id: number;
  percentage: string | number;
  fund_id: number;
  offset_account_id: number | null;
  expense_account_id: number | null;
  contact_id: number | null;
  tax_rate_id: number | null;
  memo: string | null;
  description: string | null;
  sort_order: number;
  created_at: Date | string;
  updated_at: Date | string;
}
