export type Role = 'admin' | 'editor' | 'viewer';

export type ApiErrorResponse = { error: string };
export type ApiValidationErrorResponse = { errors: string[] };

export interface MessageResponse {
  message: string;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  role: Role;
  is_active?: boolean;
}

export interface GoogleAuthRequest {
  credential: string;
}

export interface GoogleAuthResponse {
  token: string;
  user: AuthUser;
}

export interface AuthMeResponse {
  user: AuthUser;
}

export interface UserSummary {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  role: Role;
  is_active: boolean;
  created_at?: string;
}

export interface CreateUserInput {
  email: string;
  role: Role;
}

export interface UpdateUserRoleInput {
  role: Role;
}

export interface UpdateUserActiveInput {
  is_active: boolean;
}

export interface FundSummary {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  net_asset_account_id: number | null;
  net_asset_code: string | null;
  net_asset_name: string | null;
}

export interface CreateFundInput {
  name: string;
  description?: string;
  code: string;
}

export interface UpdateFundInput {
  name?: string;
  description?: string;
  is_active?: boolean;
  code?: string;
}

export interface NetAssetAccountSummary {
  id: number;
  code: string;
  name: string;
  type: 'EQUITY';
  is_active: boolean;
}

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface AccountsQuery {
  type?: string;
  include_inactive?: boolean;
}

export interface AccountSummary {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  parent_id: number | null;
  is_active: boolean;
  journal_entry_count?: string | number;
  is_deletable?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAccountInput {
  code: string;
  name: string;
  type: AccountType;
  parent_id?: number | null;
}

export interface UpdateAccountInput {
  code?: string;
  name?: string;
  type?: AccountType;
  parent_id?: number | null;
  is_active?: boolean;
}

export interface AccountsListResponse {
  accounts: AccountSummary[];
}

export interface AccountResponse {
  account: AccountSummary;
}

export interface TransactionEntryInput {
  account_id: number;
  fund_id: number;
  debit?: number;
  credit?: number;
  contact_id?: number | null;
  memo?: string;
}

export interface CreateTransactionInput {
  date: string;
  description: string;
  reference_no?: string;
  entries: TransactionEntryInput[];
}

export interface UpdateTransactionInput {
  date?: string;
  description?: string;
  reference_no?: string | null;
  entries?: TransactionEntryInput[];
}

export interface TransactionsQuery {
  fund_id?: string | number;
  account_id?: string | number;
  contact_id?: string | number;
  from?: string;
  to?: string;
  limit?: string | number;
  offset?: string | number;
}

export interface TransactionListItem {
  id: number;
  date: string;
  description: string;
  reference_no: string | null;
  fund_id: number;
  created_at: string;
  created_by_name: string | null;
  total_amount: number;
}

export interface TransactionEntryDetail {
  id: number;
  account_id: number;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  fund_id: number;
  fund_name: string;
  debit: number;
  credit: number;
  memo: string | null;
  is_reconciled: boolean;
  contact_id: number | null;
  contact_name: string | null;
}

export interface TransactionDetail {
  id: number;
  date: string;
  description: string;
  reference_no: string | null;
  fund_id: number;
  created_at: string;
  created_by_name?: string | null;
  total_amount?: number;
  entries?: TransactionEntryDetail[];
}

export interface TransactionCreateEntry {
  id: number;
  transaction_id: number;
  account_id: number;
  fund_id: number;
  contact_id: number | null;
  debit: number;
  credit: number;
  memo: string | null;
  is_reconciled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TransactionCreateResult extends TransactionDetail {
  created_by?: number;
  updated_at?: string;
  entries: TransactionCreateEntry[];
}

export interface TransactionsListResponse {
  transactions: TransactionListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface TransactionResponse {
  transaction: TransactionDetail;
}

export interface ReconciliationSummary {
  id: number;
  account_id: number;
  account_name: string;
  account_code: string;
  statement_date: string;
  statement_balance: number | string;
  opening_balance: number | string;
  is_closed: boolean;
  created_at: string;
  created_by_name: string | null;
}

export interface ReconciliationItem {
  id: number;
  journal_entry_id: number;
  is_cleared: boolean;
  date: string;
  description: string;
  reference_no: string | null;
  fund_name: string;
  debit: number;
  credit: number;
}

export interface ReconciliationSummaryCounts {
  total_items: number;
  cleared_items: number;
  uncleared_items: number;
  cleared_debits: number;
  cleared_credits: number;
}

export type ReconciliationStatus = 'BALANCED' | 'UNBALANCED';

export interface ReconciliationDetail {
  id: number;
  account_id: number;
  account_name: string;
  account_code: string;
  account_type: AccountType;
  statement_date: string;
  statement_balance: number;
  opening_balance: number;
  is_closed: boolean;
  created_at: string;
  cleared_balance: number;
  difference: number;
  status: ReconciliationStatus;
  summary: ReconciliationSummaryCounts;
  items: ReconciliationItem[];
}

export interface CreateReconciliationInput {
  account_id: number;
  statement_date: string;
  statement_balance: number;
  opening_balance?: number;
}

export interface UpdateReconciliationInput {
  statement_date?: string;
  statement_balance?: number;
}

export interface ReconciliationsResponse {
  reconciliations: ReconciliationSummary[];
}

export interface ReconciliationResponse {
  reconciliation: ReconciliationDetail;
}

export interface CreateReconciliationResponse {
  reconciliation: ReconciliationSummary;
  items_loaded: number;
}

export interface ReconciliationItemToggleResponse {
  item: {
    id: number;
    reconciliation_id: number;
    journal_entry_id: number;
    is_cleared: boolean;
    created_at: string;
    updated_at: string;
  };
  cleared_balance: number;
  difference: number;
  status: ReconciliationStatus;
}

export interface CloseReconciliationResponse {
  message: string;
  summary: ReconciliationSummaryCounts;
}
