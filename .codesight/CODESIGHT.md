# accounting-app — AI Context Map

> **Stack:** express | none | react | typescript
> **Monorepo:** church-accounting-client, church-accounting-server

> 74 routes (74 inferred) | 0 models | 35 components | 29 lib files | 13 env vars | 8 middleware
> **Token savings:** this file is ~0 tokens. Without it, AI exploration would cost ~0 tokens. **Saves ~0 tokens per conversation.**
> **Last scanned:** 2026-04-16 23:44 — re-run after significant changes

---

# Routes

## CRUD Resources

- **`/api/accounts`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Account
- **`/api/bills`** GET | POST | GET/:id | PUT/:id → Bill
- **`/api/contacts`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Contact
- **`/api/funds`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Fund
- **`/api/reconciliations`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Reconciliation
- **`/api/transactions`** GET | POST | GET/:id | PUT/:id | DELETE/:id → Transaction
- **`/api/users`** GET | POST | GET/:id | DELETE/:id → User

## Other Routes

- `GET` `/api/health` [auth, cache] `[inferred]`
- `GET` `*` [auth, cache] `[inferred]`
- `POST` `/api/auth/google` [auth, db] `[inferred]`
- `GET` `/api/auth/me` [auth, db] `[inferred]`
- `GET` `/api/bills/summary` [auth, db] `[inferred]`
- `GET` `/api/bills/reports/aging` [auth, db] `[inferred]`
- `GET` `/api/bills/:id/available-credits` params(id) [auth, db] `[inferred]`
- `POST` `/api/bills/:id/apply-credits` params(id) [auth, db] `[inferred]`
- `POST` `/api/bills/:id/unapply-credits` params(id) [auth, db] `[inferred]`
- `POST` `/api/bills/:id/pay` params(id) [auth, db] `[inferred]`
- `POST` `/api/bills/:id/void` params(id) [auth, db] `[inferred]`
- `GET` `/api/contacts/receipts/bulk` [auth, db, cache] `[inferred]`
- `PATCH` `/api/contacts/:id/deactivate` params(id) [auth, db, cache] `[inferred]`
- `GET` `/api/contacts/:id/donations` params(id) [auth, db, cache] `[inferred]`
- `GET` `/api/contacts/:id/donations/summary` params(id) [auth, db, cache] `[inferred]`
- `GET` `/api/contacts/:id/receipt` params(id) [auth, db, cache] `[inferred]`
- `GET` `/api/donation-receipts/accounts` [auth] `[inferred]`
- `GET` `/api/donation-receipts/template` [auth] `[inferred]`
- `PUT` `/api/donation-receipts/template` [auth] `[inferred]`
- `POST` `/api/donation-receipts/preview` [auth] `[inferred]`
- `POST` `/api/donation-receipts/generate-pdf` [auth] `[inferred]`
- `POST` `/api/fiscal-periods/investigate` [auth, db] `[inferred]`
- `POST` `/api/fiscal-periods/close` [auth, db] `[inferred]`
- `GET` `/api/fiscal-periods` [auth, db] `[inferred]`
- `DELETE` `/api/fiscal-periods/:id/reopen` params(id) [auth, db] `[inferred]`
- `POST` `/api/reconciliations/:id/items/:itemId/clear` params(id, itemId) [auth, db] `[inferred]`
- `POST` `/api/reconciliations/:id/close` params(id) [auth, db] `[inferred]`
- `GET` `/api/reports/pl` [auth] `[inferred]`
- `GET` `/api/reports/balance-sheet` [auth] `[inferred]`
- `GET` `/api/reports/ledger` [auth] `[inferred]`
- `GET` `/api/reports/trial-balance` [auth] `[inferred]`
- `GET` `/api/reports/donors/summary` [auth] `[inferred]`
- `GET` `/api/reports/donors/detail` [auth] `[inferred]`
- `GET` `/api/settings` [auth, db] `[inferred]`
- `PUT` `/api/settings` [auth, db] `[inferred]`
- `GET` `/api/tax-rates` [auth, db] `[inferred]`
- `PUT` `/api/tax-rates/:id` params(id) [auth, db] `[inferred]`
- `PATCH` `/api/tax-rates/:id/toggle` params(id) [auth, db] `[inferred]`
- `POST` `/api/transactions/import/bill-matches` [auth, db] `[inferred]`
- `POST` `/api/transactions/import` [auth, db] `[inferred]`
- `PUT` `/api/users/:id/role` params(id) [auth, db] `[inferred]`
- `PUT` `/api/users/:id/active` params(id) [auth, db] `[inferred]`

---

# Components

- **App** — `client/src/App.tsx`
- **ExpenseBreakdown** — props: lines, lineTotals, expenseAccountOptions, taxRateOptions, onChange, onRemove, errors, readOnly, showGrossColumn, minWidth — `client/src/components/ExpenseBreakdown.tsx`
- **FullScreenSpinner** — `client/src/components/FullScreenSpinner.tsx`
- **Layout** — `client/src/components/Layout.tsx`
- **ProtectedRoute** — `client/src/components/ProtectedRoute.tsx`
- **RoleGuard** — props: roles, fallback — `client/src/components/RoleGuard.tsx`
- **SaveTemplateModal** — props: isOpen, onClose, onSave, title, placeholder — `client/src/components/SaveTemplateModal.tsx`
- **TemplateDropdown** — props: templates, isOpen, onToggle, onLoad, onDelete — `client/src/components/TemplateDropdown.tsx`
- **AuthProvider** — `client/src/context/AuthContext.tsx`
- **DateProvider** — `client/src/context/DateContext.tsx`
- **GOOGLE_CLIENT_ID** — `client/src/main.tsx`
- **Bills** — `client/src/pages/Bills.tsx`
- **ChartOfAccounts** — `client/src/pages/ChartOfAccounts.tsx`
- **Contacts** — `client/src/pages/Contacts.tsx`
- **Dashboard** — props: label, value, isLoading, color, sub — `client/src/pages/Dashboard.tsx`
- **DepositEntry** — `client/src/pages/DepositEntry.tsx`
- **DonationReceipts** — `client/src/pages/DonationReceipts.tsx`
- **ExpenseEntry** — `client/src/pages/ExpenseEntry.tsx`
- **HardCloseWizard** — props: open, onClose, onSuccess — `client/src/pages/HardClose.tsx`
- **ImportCsv** — `client/src/pages/ImportCsv.tsx`
- **Login** — `client/src/pages/Login.tsx`
- **Reconciliation** — props: id, onBack — `client/src/pages/Reconciliation.tsx`
- **Reports** — `client/src/pages/Reports.tsx`
- **Settings** — `client/src/pages/Settings.tsx`
- **Transactions** — props: onClose, onSaved — `client/src/pages/Transactions.tsx`
- **UserManagement** — `client/src/pages/UserManagement.tsx`
- **BillForm** — props: bill, onClose, onSaved — `client/src/pages/bills/BillForm.tsx`
- **BillsTable** — props: bills, isLoading, canEdit, onPay, onRowClick — `client/src/pages/bills/BillsTable.tsx`
- **PaymentModal** — props: bill, isOpen, onClose, onPaid — `client/src/pages/bills/PaymentModal.tsx`
- **ImportPreviewTable** — props: rows, selectedRows, suggestionsByRow, offsetOptions, donorOptions, payeeOptions, onSelectedRowsChange, onToggleRow, onOffsetChange, onReferenceChange — `client/src/pages/importCsv/ImportPreviewTable.tsx`
- **ImportSetupPanel** — props: bankAccountId, fundId, bankAccountOptions, fundOptions, isParsing, parsedRowCount, parseError, parseWarnings, onFileChange, onBankAccountChange — `client/src/pages/importCsv/ImportSetupPanel.tsx`
- **SplitTransactionModal** — props: isOpen, onClose, onSave, row, defaultFundId, offsetAccountOptions, fundOptions, donorOptions, payeeOptions, expenseAccountOptions — `client/src/pages/importCsv/SplitTransactionModal.tsx`
- **DiagnosticsPanel** — props: diagnostics, onInvestigate — `client/src/pages/reports/ReportSections.tsx`
- **PLReport** — props: data — `client/src/pages/reports/reportRenderers.tsx`
- **DonationReceiptsPdfDocument** — props: receipts — `server/services/donationReceiptPdf.tsx`

---

# Libraries

- `client/src/api/useAccounts.ts`
  - function useAccounts: (params) => void
  - function useCreateAccount: () => void
  - function useUpdateAccount: () => void
  - function useDeleteAccount: () => void
- `client/src/api/useBills.ts`
  - function useAvailableBillCredits: (id) => void
  - function useBills: (params) => void
  - function useBill: (id) => void
  - function useBillSummary: () => void
  - function useAgingReport: (asOfDate?) => void
  - function useCreateBill: () => void
  - _...5 more_
- `client/src/api/useContacts.ts`
  - function useContacts: (params) => void
  - function useContact: (id, options) => void
  - function useCreateContact: () => void
  - function useUpdateContact: () => void
  - function useDeleteContact: () => void
  - function useDeactivateContact: () => void
  - _...3 more_
- `client/src/api/useDashboard.ts`
  - function usePLSummary: () => void
  - function useBalanceSheet: () => void
  - function useRecentTransactions: (limit) => void
- `client/src/api/useDonationReceipts.ts`
  - function useDonationReceiptAccounts: (fiscalYear, enabled) => void
  - function useDonationReceiptTemplate: (enabled) => void
  - function useSaveDonationReceiptTemplate: () => void
  - function usePreviewDonationReceipt: () => void
  - function useGenerateDonationReceiptPdf: () => void
- `client/src/api/useExpenseTemplates.ts`
  - function useExpenseTemplates: () => void
  - interface ExpenseTemplateRow
  - interface ExpenseTemplate
- `client/src/api/useFiscalPeriods.ts` — function useFiscalPeriods: () => void, function useReopenFiscalPeriod: () => void
- `client/src/api/useFunds.ts`
  - function useFunds: (params) => void
  - function useCreateFund: () => void
  - function useUpdateFund: () => void
  - function useDeleteFund: () => void
- `client/src/api/useReconciliation.ts`
  - function useReconciliations: () => void
  - function useReconciliation: (id) => void
  - function useCreateReconciliation: () => void
  - function useUpdateReconciliation: () => void
  - function useClearItem: (reconciliationId) => void
  - function useCloseReconciliation: () => void
  - _...1 more_
- `client/src/api/useReports.ts`
  - function usePLReport: (filters, enabled) => void
  - function useBalanceSheetReport: (filters, enabled) => void
  - function useLedgerReport: (filters, enabled) => void
  - function useTrialBalanceReport: (filters, enabled) => void
  - function useDonorSummaryReport: (filters, enabled) => void
  - function useDonorDetailReport: (filters, enabled) => void
- `client/src/api/useSettings.ts` — function useSettings: (enabled) => void, function useUpdateSettings: () => void
- `client/src/api/useTaxRates.ts`
  - function useTaxRates: ({...}) => void
  - function useUpdateTaxRate: () => void
  - function useToggleTaxRate: () => void
- `client/src/api/useTransactionTemplates.ts`
  - function useTransactionTemplates: () => void
  - interface TransactionTemplateRow
  - interface TransactionTemplate
- `client/src/api/useTransactions.ts`
  - function useTransactions: (params) => void
  - function useTransaction: (id) => void
  - function useCreateTransaction: () => void
  - function useUpdateTransaction: () => void
  - function useDeleteTransaction: () => void
  - function useImportTransactions: () => void
  - _...1 more_
- `client/src/api/useUsers.ts`
  - function useUsers: () => void
  - function useCreateUser: () => void
  - function useUpdateUserRole: () => void
  - function useUpdateUserActive: () => void
  - function useDeleteUser: () => void
- `client/src/utils/date.ts`
  - function isValidTimeZone: (value?) => void
  - function setChurchTimeZone: (value?) => void
  - function getChurchTimeZone: () => void
  - function parseDateOnlyStrict: (value?) => void
  - function toDateOnly: (value?) => void
  - function getChurchToday: (timeZone?) => void
  - _...10 more_
- `client/src/utils/errors.ts` — function getErrorMessage: (err, fallback) => string
- `client/src/utils/parseStatementCsv.ts` — function parseStatementCsv: (file) => Promise<ParseStatementCsvResult>
- `server/services/bills/billCredits.ts`
  - function getAvailableCreditsForBill: (id) => Promise<AvailableBillCredit[]>
  - function unapplyBillCredits: (id, userId) => Promise<
  - function applyBillCredits: (id, payload, userId) => Promise<
- `server/services/bills/billPosting.ts`
  - function getUniqueTaxRateIds: (lineItems) => void
  - function calculateGrossTotalFromLineItems: (lineItems, taxRateMap, TaxRateRow>) => void
  - function createMultiLineJournalEntries: (transactionId, lineItems, fundId, apAccountId, contactId, contactName, billNumber, trx) => void
  - interface TaxRateRow
  - const ROUNDING_ACCOUNT_CODE
- `server/services/bills/billReadModel.ts`
  - function normaliseApplications: (rows) => BillCreditApplication[]
  - function getBillWithLineItems: (billId, executor) => Promise<BillDetail | null>
  - interface ApplicationJoinedRow
- `server/services/bills/billReports.ts` — function getAgingReport: (asOfDate) => void, function getUnpaidSummary: () => Promise<BillSummaryResponse['summary']>
- `server/services/bills/billSettlement.ts`
  - function getOutstanding: (amount, amountPaid) => void
  - function isSettledOutstanding: (outstanding) => void
  - function toBillStatus: (outstanding) => BillRow['status']
  - function buildBillSettlementPatch: (bill, 'amount'>, nextOutstanding, userId, trx) => void
  - function formatBillReference: (bill, 'id' | 'bill_number'>) => void
  - const AP_ACCOUNT_CODE
- `server/services/bills/billValidation.ts`
  - function validateBillData: (data, isUpdate) => string[]
  - function resolveTaxRateMap: (lineItems, executor) => Promise<Record<number, TaxRateRow>>
  - function validateLineItemAccounts: (lineItems) => Promise<string[]>
- `server/services/churchTimeZone.ts`
  - function getChurchTimeZone: () => void
  - function setChurchTimeZone: (value?) => void
  - function initializeChurchTimeZoneCache: () => void
- `server/services/donationReceipts.ts`
  - function getReceiptAccounts: (fiscalYear) => Promise<DonationReceiptAccountsResponse>
  - function getReceiptTemplate: () => Promise<DonationReceiptTemplateResponse>
  - function saveReceiptTemplate: (markdownBody, userId) => Promise<DonationReceiptTemplateResponse>
  - function previewReceipt: (fiscalYear, accountIds, markdownBody?) => Promise<DonationReceiptPreviewResponse>
  - function generateReceiptPdf: (fiscalYear, accountIds, markdownBody?) => Promise<DonationReceiptGeneratePdfResponse>
- `server/services/donorDonations.ts`
  - function getDonationLines: ({...}, to, fundId, accountIds, contactId, includeAnonymous, }) => Promise<DonationLine[]>
  - interface DonationLineFilters
  - interface DonationLineRow
  - interface DonationLine
  - type Numeric
- `server/utils/date.ts`
  - function isValidTimeZone: (value?) => void
  - function parseDateOnlyStrict: (value?) => void
  - function isValidDateOnly: (value?) => void
  - function getChurchToday: (timeZone?) => void
  - function addDaysDateOnly: (value, days, timeZone?) => void
  - function compareDateOnly: (left?, right?) => void
  - _...3 more_
- `server/utils/hardCloseGuard.ts`
  - function acquireHardCloseLock: (trx) => Promise<void>
  - function assertNotClosedPeriod: (date, trx) => Promise<void>
  - const HARD_CLOSE_LOCK_KEY

---

# Config

## Environment Variables

- `CLIENT_ORIGIN` **required** — server/index.ts
- `DATABASE_URL` (has default) — server/.env.example
- `DATABASE_URL_PROD` (has default) — server/.env
- `DB_NAME` (has default) — server/.env
- `DB_PASS` (has default) — server/.env
- `DB_USER` (has default) — server/.env
- `GOOGLE_CLIENT_ID` (has default) — server/.env.example
- `GOOGLE_CLIENT_SECRET` (has default) — server/.env
- `JWT_SECRET` (has default) — server/.env.example
- `NODE_ENV` (has default) — server/.env.example
- `PORT` (has default) — server/.env.example
- `VITE_API_BASE_URL` (has default) — client/.env.example
- `VITE_GOOGLE_CLIENT_ID` (has default) — client/.env.example

## Config Files

- `client/.env.example`
- `client/vite.config.ts`
- `server/.env.example`

---

# Middleware

## custom
- 017_add_tax_rates — `server/db/migrations/017_add_tax_rates.js`
- 018_add_tax_rate_id_to_bill_line_items — `server/db/migrations/018_add_tax_rate_id_to_bill_line_items.js`
- 03_tax_rates — `server/db/seeds/03_tax_rates.js`

## auth
- auth — `server/middleware/auth.ts`
- roles — `server/middleware/roles.ts`
- auth — `server/routes/auth.ts`
- authRoutes — `server/index.ts`

## cors
- cors — `server/index.ts`

---

# Dependency Graph

## Most Imported Files (change these carefully)

- `client/src/components/ui/types.ts` — imported by **26** files
- `server/db/index.js` — imported by **23** files
- `client/src/components/ui/Button.tsx` — imported by **22** files
- `client/src/utils/date.ts` — imported by **19** files
- `client/src/api/client.ts` — imported by **17** files
- `client/src/components/ui/Input.tsx` — imported by **15** files
- `client/src/utils/errors.ts` — imported by **15** files
- `server/utils/date.ts` — imported by **14** files
- `client/src/components/ui/Toast.tsx` — imported by **13** files
- `server/middleware/auth.ts` — imported by **13** files
- `client/src/context/AuthContext.tsx` — imported by **12** files
- `client/src/components/ui/Combobox.tsx` — imported by **12** files
- `client/src/components/ui/Select.tsx` — imported by **11** files
- `client/src/components/ui/Card.tsx` — imported by **11** files
- `client/src/api/useAccounts.ts` — imported by **10** files
- `server/middleware/roles.ts` — imported by **10** files
- `client/src/components/ui/Modal.tsx` — imported by **8** files
- `server/services/churchTimeZone.ts` — imported by **8** files
- `client/src/api/useContacts.ts` — imported by **7** files
- `client/src/api/useFunds.ts` — imported by **7** files

## Import Map (who imports what)

- `client/src/components/ui/types.ts` ← `client/src/api/useExpenseTemplates.ts`, `client/src/components/ExpenseBreakdown.tsx`, `client/src/components/ui/Combobox.tsx`, `client/src/components/ui/MultiSelectCombobox.tsx`, `client/src/components/ui/Select.tsx` +21 more
- `server/db/index.js` ← `server/routes/accounts.ts`, `server/routes/auth.ts`, `server/routes/bills.ts`, `server/routes/contacts.ts`, `server/routes/fiscalPeriods.ts` +18 more
- `client/src/components/ui/Button.tsx` ← `client/src/components/SaveTemplateModal.tsx`, `client/src/components/TemplateDropdown.tsx`, `client/src/components/ui/TransactionTable.tsx`, `client/src/pages/Bills.tsx`, `client/src/pages/ChartOfAccounts.tsx` +17 more
- `client/src/utils/date.ts` ← `client/src/api/useDashboard.ts`, `client/src/components/ui/DateRangePicker.tsx`, `client/src/components/ui/TransactionTable.tsx`, `client/src/pages/Bills.tsx`, `client/src/pages/ChartOfAccounts.tsx` +14 more
- `client/src/api/client.ts` ← `client/src/api/useAccounts.ts`, `client/src/api/useBills.ts`, `client/src/api/useContacts.ts`, `client/src/api/useDashboard.ts`, `client/src/api/useDonationReceipts.ts` +12 more
- `client/src/components/ui/Input.tsx` ← `client/src/components/ExpenseBreakdown.tsx`, `client/src/components/SaveTemplateModal.tsx`, `client/src/pages/ChartOfAccounts.tsx`, `client/src/pages/Contacts.tsx`, `client/src/pages/DepositEntry.tsx` +10 more
- `client/src/utils/errors.ts` ← `client/src/pages/Bills.tsx`, `client/src/pages/ChartOfAccounts.tsx`, `client/src/pages/Contacts.tsx`, `client/src/pages/DepositEntry.tsx`, `client/src/pages/DonationReceipts.tsx` +10 more
- `server/utils/date.ts` ← `server/routes/bills.ts`, `server/routes/fiscalPeriods.ts`, `server/routes/reconciliation.ts`, `server/routes/reports.ts`, `server/routes/settings.ts` +9 more
- `client/src/components/ui/Toast.tsx` ← `client/src/main.tsx`, `client/src/pages/Bills.tsx`, `client/src/pages/ChartOfAccounts.tsx`, `client/src/pages/Contacts.tsx`, `client/src/pages/DepositEntry.tsx` +8 more
- `server/middleware/auth.ts` ← `server/routes/accounts.ts`, `server/routes/auth.ts`, `server/routes/bills.ts`, `server/routes/contacts.ts`, `server/routes/donationReceipts.ts` +8 more

---

_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_