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
export type NormalBalanceSide = 'DEBIT' | 'CREDIT';
export type AccountClass =
  | 'ASSET'
  | 'CONTRA_ASSET'
  | 'LIABILITY'
  | 'CONTRA_LIABILITY'
  | 'EQUITY'
  | 'CONTRA_EQUITY'
  | 'INCOME'
  | 'CONTRA_INCOME'
  | 'EXPENSE'
  | 'CONTRA_EXPENSE';

export interface AccountsQuery {
  type?: string;
  include_inactive?: boolean;
}

export interface AccountSummary {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  account_class: AccountClass;
  normal_balance: NormalBalanceSide | null;
  parent_id: number | null;
  is_active: boolean;
  journal_entry_count?: number;
  is_deletable?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAccountInput {
  code: string;
  name: string;
  type: AccountType;
  account_class?: AccountClass;
  normal_balance?: NormalBalanceSide | null;
  parent_id?: number | null;
}

export interface UpdateAccountInput {
  code?: string;
  name?: string;
  type?: AccountType;
  account_class?: AccountClass;
  normal_balance?: NormalBalanceSide | null;
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

export interface TransactionSplit {
  amount: number;
  offset_account_id?: number;
  fund_id: number;
  contact_id?: number | null;
  memo?: string | null;
  expense_account_id?: number;
  tax_rate_id?: number | null;
  pre_tax_amount?: number;
  rounding_adjustment?: number;
  description?: string | null;
}

export interface ImportTransactionRow {
  date: string;
  description: string;
  reference_no?: string;
  amount: number;
  type: 'withdrawal' | 'deposit';
  offset_account_id?: number;
  payee_id?: number;
  contact_id?: number;
  bill_id?: number;
  splits?: TransactionSplit[];
}

export interface ImportTransactionsInput {
  bank_account_id: number;
  fund_id: number;
  rows: ImportTransactionRow[];
  force?: boolean;
}

export interface SkippedImportRow {
  row_index: number;
  reason: string;
  date: string;
  amount: number;
  description: string;
  reference_no?: string | null;
}

export interface ImportTransactionsResult {
  imported: number;
  skipped: number;
  skipped_rows: SkippedImportRow[];
}

export interface GetBillMatchesInput {
  bank_account_id: number;
  rows: GetBillMatchRowInput[];
}

export interface GetBillMatchRowInput {
  row_index: number;
  date: string;
  amount: number;
  type: 'withdrawal' | 'deposit';
}

export interface BillMatchSuggestion {
  row_index: number;
  bill_id: number;
  bill_number: string | null;
  vendor_name: string | null;
  bill_date: string;
  due_date: string | null;
  balance_due: number;
  confidence: 'exact' | 'possible';
}

export interface GetBillMatchesResult {
  suggestions: BillMatchSuggestion[];
}

export interface TransactionsQuery {
  fund_id?: string | number;
  account_id?: string | number;
  contact_id?: string | number;
  include_inactive?: boolean | 'true' | 'false';
  transaction_type?: 'deposit' | 'withdrawal' | 'transfer';
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
  contact_name: string | null;
  has_multiple_contacts: boolean;
  fund_id: number;
  created_at: string;
  created_by_name: string | null;
  total_amount: number;
  transaction_type: 'deposit' | 'withdrawal' | 'transfer';
  is_voided: boolean;
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
  is_voided: boolean;
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

export interface TransactionCreateResult extends Omit<TransactionDetail, 'entries'> {
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
  statement_balance: number;
  opening_balance: number;
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

export type ContactType = 'DONOR' | 'PAYEE' | 'BOTH';
export type ContactClass = 'INDIVIDUAL' | 'HOUSEHOLD';

export interface ContactSummary {
  id: number;
  type: ContactType;
  contact_class: ContactClass;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  donor_id: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface ContactDetail extends ContactSummary {
  address_line1: string | null;
  address_line2: string | null;
  notes: string | null;
  updated_at?: string;
}

export interface ContactsQuery {
  type?: ContactType;
  class?: ContactClass;
  search?: string;
  include_inactive?: boolean;
}

export interface CreateContactInput {
  type: ContactType;
  contact_class: ContactClass;
  name: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  notes?: string;
  donor_id?: string;
}

export interface UpdateContactInput {
  type?: ContactType;
  contact_class?: ContactClass;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  notes?: string;
  donor_id?: string;
  is_active?: boolean;
}

export interface ContactsListResponse {
  contacts: ContactSummary[];
}

export interface ContactResponse {
  contact: ContactDetail;
}

export interface ContactDonation {
  transaction_id: number;
  date: string;
  description: string;
  reference_no: string | null;
  account_name: string;
  account_code: string;
  fund_name: string;
  amount: number;
  memo: string | null;
}

export interface ContactDonationSummaryItem {
  year: number;
  total: number;
  donation_count: number;
}

export interface ContactReceipt {
  church: {
    name: string;
    address_line1: string;
    address_line2: string;
    city: string;
    province: string;
    postal_code: string;
    phone: string;
    email: string;
    registration_no: string | null;
    signature_url: string | null;
  };
  donor: {
    name: string;
    first_name: string | null;
    last_name: string | null;
    donor_id: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    province: string | null;
    postal_code: string | null;
  };
  year: number;
  generated_at: string;
  donations: Array<{
    date: string;
    description: string;
    reference_no: string | null;
    account_name: string;
    amount: number;
    memo: string | null;
  }>;
  total: number;
  eligible_amount: number;
}

export interface ContactDonationsResponse {
  contact: { id: number; name: string; donor_id: string | null };
  donations: ContactDonation[];
}

export interface ContactDonationsSummaryResponse {
  contact: { id: number; name: string; donor_id: string | null };
  summary: ContactDonationSummaryItem[];
}

export interface ContactReceiptResponse {
  receipt: ContactReceipt;
}

export interface BulkReceiptsResponse {
  year: number;
  church: {
    name: string;
    address_line1: string;
    city: string;
    province: string;
    postal_code: string;
    registration_no: string | null;
    signature_url: string | null;
  };
  count: number;
  receipts: BulkReceiptItem[];
}

export interface BulkReceiptItem {
  donor: ContactDetail;
  year: number;
  donations: Array<{
    date: string;
    description: string;
    account_name: string;
    amount: number;
  }>;
  total: number;
  eligible_amount: number;
}

export type BillStatus = 'UNPAID' | 'PAID' | 'VOID';

export interface BillLineItem {
  id: number;
  expense_account_id: number;
  amount: number;
  rounding_adjustment: number;
  description: string | null;
  expense_account_code?: string;
  expense_account_name?: string;
  tax_rate_id?: number | null;
  tax_rate_name?: string | null;
  tax_rate_value?: number | null;
  tax_amount?: number | null;
}

export interface BillSummary {
  id: number;
  contact_id: number;
  date: string;
  due_date: string | null;
  bill_number: string | null;
  description: string;
  amount: number;
  amount_paid: number;
  status: BillStatus;
  fund_id: number;
  transaction_id: number | null;
  created_transaction_id: number | null;
  created_by: number;
  paid_by: number | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  vendor_name?: string | null;
  fund_name?: string | null;
  created_by_name?: string | null;
  is_voided?: boolean;
  line_items?: BillLineItem[];
}

export interface BillDetail extends BillSummary {
  vendor_email?: string | null;
  vendor_phone?: string | null;
  paid_by_name?: string | null;
  available_credit_total?: number;
  applied_credits?: BillCreditApplication[];
  payment_transaction?: {
    id: number;
    date: string;
    description: string;
    reference_no: string | null;
    created_by_name: string | null;
  } | null;
}

export interface BillsQuery {
  status?: BillStatus | BillStatus[];
  contact_id?: number | string;
  from?: string;
  to?: string;
  limit?: number | string;
  offset?: number | string;
}

export interface BillLineItemInput {
  expense_account_id: number;
  amount: number;
  rounding_adjustment?: number | null;
  description?: string;
  tax_rate_id?: number | null;
}

export interface CreateBillInput {
  contact_id: number;
  date: string;
  due_date?: string | null;
  bill_number?: string | null;
  description: string;
  amount: number;
  fund_id: number;
  line_items: BillLineItemInput[];
}

export interface UpdateBillInput {
  contact_id?: number;
  date?: string;
  due_date?: string | null;
  bill_number?: string | null;
  description?: string;
  amount?: number;
  fund_id?: number;
  line_items?: BillLineItemInput[];
  confirm_unapply_credits?: boolean;
}

export interface PayBillInput {
  payment_date?: string;
  bank_account_id?: number;
  memo?: string;
  amount?: number;
  reference_no?: string;
}

export interface BillCreditApplication {
  id: number;
  target_bill_id: number;
  credit_bill_id: number;
  amount: number;
  apply_transaction_id: number | null;
  applied_by: number;
  applied_by_name?: string | null;
  applied_at: string;
  unapplied_at?: string | null;
  credit_bill_number?: string | null;
  credit_bill_date?: string;
}

export interface AvailableBillCredit {
  bill_id: number;
  bill_number: string | null;
  date: string;
  description: string;
  original_amount: number;
  amount_paid: number;
  outstanding: number;
  available_amount: number;
}

export interface BillCreditApplicationInput {
  credit_bill_id: number;
  amount: number;
}

export interface ApplyBillCreditsInput {
  applications: BillCreditApplicationInput[];
}

export interface AvailableBillCreditsResponse {
  credits: AvailableBillCredit[];
  target_bill_id: number;
  target_outstanding: number;
}

export interface ApplyBillCreditsResponse {
  bill: BillDetail;
  applications: BillCreditApplication[];
  transaction?: {
    id: number;
    date: string;
    description: string;
    reference_no: string | null;
    fund_id: number;
    created_by: number;
    created_at: string;
    updated_at: string;
  };
}

export interface UnapplyBillCreditsResponse {
  bill: BillDetail;
  unapplied_count: number;
}

export interface BillsListResponse {
  bills: BillSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface BillResponse {
  bill: BillDetail;
}

export interface BillMutationResponse {
  bill: BillDetail;
  transaction?: {
    id: number;
    date: string;
    description: string;
    reference_no: string | null;
    fund_id: number;
    created_by: number;
    created_at: string;
    updated_at: string;
  };
}

export interface BillSummaryResponse {
  summary: {
    count: number;
    total_outstanding: number;
    earliest_due: string | null;
  };
}

export interface BillAgingVendor {
  vendor_name: string;
  contact_id: number;
  current: number;
  days31_60: number;
  days61_90: number;
  days90_plus: number;
  total: number;
}

export interface BillAgingBill {
  id: number;
  contact_id: number;
  vendor_name: string;
  bill_number: string | null;
  description: string;
  amount: number;
  amount_paid: number;
  due_date: string;
  outstanding: number;
  days_overdue: number;
}

export interface BillAgingTotals {
  current: number;
  days31_60: number;
  days61_90: number;
  days90_plus: number;
  total: number;
}

export interface BillAgingBuckets {
  current: BillAgingBill[];
  days31_60: BillAgingBill[];
  days61_90: BillAgingBill[];
  days90_plus: BillAgingBill[];
}

export interface BillAgingReportResponse {
  report: {
    as_of_date: string;
    vendor_aging: BillAgingVendor[];
    totals: BillAgingTotals;
    buckets: BillAgingBuckets;
  };
}

export type BillServiceError = {
  errors: string[];
  outstanding?: number;
};

export interface FiscalPeriod {
  id: number;
  fiscal_year: number;
  period_start: string;
  period_end: string;
  status: 'HARD_CLOSED';
  closing_transaction_id: number | null;
  closed_by: number | null;
  closed_at: string;
}

export interface HardCloseProFormaLine {
  account_id: number;
  account_code: string;
  account_name: string;
  account_type: 'INCOME' | 'EXPENSE' | 'EQUITY';
  fund_id: number;
  fund_name: string;
  debit: number;
  credit: number;
}

export interface HardClosePreflightResult {
  trial_balance_plugs: boolean;
  per_fund_balanced: boolean;
  all_asset_accounts_reconciled: boolean;
  no_unmapped_funds: boolean;
}

export interface HardCloseInvestigateResponse {
  fiscal_year: number;
  period_start: string;
  period_end: string;
  pro_forma_lines: HardCloseProFormaLine[];
  preflight: HardClosePreflightResult;
}

export interface HardCloseExecuteResponse {
  fiscal_period: FiscalPeriod;
  closing_transaction_id: number;
}

export type ReportType =
  | 'pl'
  | 'balance-sheet'
  | 'ledger'
  | 'trial-balance'
  | 'donors-summary'
  | 'donors-detail';

export interface ReportEnvelope<TType extends ReportType, TFilters, TData> {
  type: TType;
  generated_at: string;
  filters: TFilters;
  data: TData;
}

export interface DateRangeReportFilters {
  from: string;
  to: string;
  fund_id?: string | number;
}

export interface PLReportFilters extends DateRangeReportFilters {}

export interface BalanceSheetReportFilters {
  as_of: string;
  fund_id?: string | number;
}

export interface LedgerReportFilters extends DateRangeReportFilters {
  account_id?: string | number;
}

export interface TrialBalanceReportFilters {
  as_of: string;
  fund_id?: string | number;
}

export interface DonorSummaryReportFilters extends DateRangeReportFilters {
  account_ids?: string;
}

export interface DonorDetailReportFilters extends DateRangeReportFilters {
  contact_id?: string | number;
  account_ids?: string;
}

export interface ReportAccountAmount {
  id: number;
  code: string;
  name: string;
  amount: number;
}

export interface ReportAccountBalance {
  id: number;
  code: string;
  name: string;
  balance: number;
  is_synthetic?: boolean;
  synthetic_note?: string | null;
  investigate_filters?: ReportInvestigateFilters | null;
}

export interface PLReportData {
  income: ReportAccountAmount[];
  expenses: ReportAccountAmount[];
  total_income: number;
  total_expenses: number;
  net_surplus: number;
}

export interface BalanceSheetReportData {
  assets: ReportAccountBalance[];
  liabilities: ReportAccountBalance[];
  equity: ReportAccountBalance[];
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  total_liabilities_and_equity: number;
  is_balanced: boolean;
  diagnostics: ReportDiagnostic[];
  last_hard_close_date: string | null;
}

export interface LedgerReportRow {
  date: string;
  description: string;
  reference_no: string | null;
  contact_name: string | null;
  fund_name: string;
  debit: number;
  credit: number;
  memo: string | null;
  balance: number;
}

export interface LedgerReportAccount {
  account: {
    id: number;
    code: string;
    name: string;
    type: AccountType;
  };
  opening_balance: number;
  closing_balance: number;
  rows: LedgerReportRow[];
}

export interface LedgerReportData {
  ledger: LedgerReportAccount[];
}

export interface TrialBalanceReportAccount {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  account_class: AccountClass;
  normal_balance: NormalBalanceSide;
  net_side: NormalBalanceSide | null;
  net_debit: number;
  net_credit: number;
  total_debit: number;
  total_credit: number;
  is_abnormal_balance: boolean;
  is_synthetic: boolean;
  synthetic_note: string | null;
  investigate_filters: ReportInvestigateFilters | null;
}

export interface ReportInvestigateFilters {
  from: string;
  to: string;
  fund_id: number | null;
  account_id?: number | null;
}

export interface ReportDiagnostic {
  code: 'ABNORMAL_BALANCE' | 'UNMAPPED_FUND_NET_ASSET' | 'MISSING_EQUITY_ACCOUNTS' | 'BALANCED' | 'UNBALANCED' | 'SUGGEST_HARD_CLOSE' | 'PERIOD_HARD_CLOSED';
  severity: 'warning' | 'info';
  message: string;
  account_id: number | null;
  fund_id: number | null;
  investigate_filters: ReportInvestigateFilters | null;
}

export interface TrialBalanceReportData {
  accounts: TrialBalanceReportAccount[];
  grand_total_debit: number;
  grand_total_credit: number;
  is_balanced: boolean;
  as_of: string;
  fiscal_year_start: string;
  diagnostics: ReportDiagnostic[];
  last_hard_close_date: string | null;
}

/** @deprecated use ReportDiagnostic */
export type TrialBalanceDiagnostic = ReportDiagnostic;

export interface DonorSummaryReportDonor {
  contact_id: number;
  contact_name: string;
  contact_class: ContactClass;
  total: number;
  transaction_count: number;
}

export interface DonorSummaryReportData {
  donors: DonorSummaryReportDonor[];
  anonymous: {
    total: number;
    transaction_count: number;
  } | null;
  grand_total: number;
  donor_count: number;
}

export interface DonorDetailReportTransaction {
  transaction_id: number;
  date: string;
  description: string;
  reference_no: string | null;
  account_code: string;
  account_name: string;
  fund_name: string;
  amount: number;
  memo: string | null;
}

export interface DonorDetailReportDonor {
  contact_id: number;
  contact_name: string;
  contact_class: ContactClass;
  donor_id: string | null;
  total: number;
  transactions: DonorDetailReportTransaction[];
}

export interface DonorDetailReportData {
  donors: DonorDetailReportDonor[];
  anonymous: {
    total: number;
    transactions: DonorDetailReportTransaction[];
  } | null;
  grand_total: number;
}

export interface PLReportResponse {
  report: ReportEnvelope<'pl', PLReportFilters, PLReportData>;
}

export interface BalanceSheetReportResponse {
  report: ReportEnvelope<'balance-sheet', BalanceSheetReportFilters, BalanceSheetReportData>;
}

export interface LedgerReportResponse {
  report: ReportEnvelope<'ledger', LedgerReportFilters, LedgerReportData>;
}

export interface TrialBalanceReportResponse {
  report: ReportEnvelope<'trial-balance', TrialBalanceReportFilters, TrialBalanceReportData>;
}

export interface DonorSummaryReportResponse {
  report: ReportEnvelope<'donors-summary', DonorSummaryReportFilters, DonorSummaryReportData>;
}

export interface DonorDetailReportResponse {
  report: ReportEnvelope<'donors-detail', DonorDetailReportFilters, DonorDetailReportData>;
}

export interface DonationReceiptAccount {
  id: number;
  code: string;
  name: string;
  total: number;
}

export interface DonationReceiptAccountsResponse {
  fiscal_year: number;
  period_start: string;
  period_end: string;
  accounts: DonationReceiptAccount[];
}

export interface DonationReceiptTemplate {
  markdown_body: string;
  updated_at: string | null;
}

export interface DonationReceiptTemplateResponse {
  template: DonationReceiptTemplate;
  variables: string[];
}

export interface UpdateDonationReceiptTemplateInput {
  markdown_body: string;
}

export interface DonationReceiptPreviewInput {
  fiscal_year: number;
  account_ids: number[];
  markdown_body?: string;
}

export interface DonationReceiptPreviewResponse {
  markdown: string | null;
  warnings: string[];
  donor_count: number;
}

export interface DonationReceiptGenerateInput {
  fiscal_year: number;
  account_ids: number[];
  markdown_body?: string;
}

export interface DonationReceiptGenerateMeta {
  fiscal_year: number;
  period_start: string;
  period_end: string;
  donor_count: number;
  warnings: string[];
}

export interface DonationReceiptGenerateResponse {
  receipts: string[];
  meta: DonationReceiptGenerateMeta;
}

export interface SettingItem {
  id: number;
  key: string;
  value: string | null;
  label: string;
  created_at: string;
  updated_at: string;
}

export type SettingsValues = Record<string, string | null>;

export type UpdateSettingsInput = Record<string, string | null | undefined>;

export interface SettingsResponse {
  settings: SettingItem[];
  values: SettingsValues;
}

export interface TaxRateSummary {
  id: number;
  name: string;
  rate: number;
  rebate_percentage: number;
  is_active: boolean;
  recoverable_account_id: number | null;
  recoverable_account_code: string | null;
  recoverable_account_name: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TaxRatesListResponse {
  tax_rates: TaxRateSummary[];
}

export interface TaxRateResponse {
  tax_rate: TaxRateSummary;
}

export interface UpdateTaxRateInput {
  // Matches current server route: PUT /api/tax-rates/:id accepts only `rate`.
  rate: number;
}
