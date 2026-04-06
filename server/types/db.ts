import type { AccountType, Role } from '../../shared/contracts.js';

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
  fund_id: number;
  created_at: Date | string;
  created_by_name: string | null;
  total_amount: string | number;
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
