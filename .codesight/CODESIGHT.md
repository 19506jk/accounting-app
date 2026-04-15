# accounting-app — AI Context Map

> **Stack:** express | none | react | typescript
> **Monorepo:** church-accounting-client, church-accounting-server

> 74 routes (74 inferred) | 0 models | 27 components | 28 lib files | 13 env vars | 8 middleware
> **Token savings:** this file is ~5,000 tokens. Without it, AI exploration would cost ~67,400 tokens. **Saves ~62,400 tokens per conversation.**
> **Last scanned:** 2026-04-15 22:10 — re-run after significant changes

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
- `POST` `/api/donation-receipts/generate` [auth] `[inferred]`
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
- `POST` `/api/transactions/import/bill-matches` [auth, db, queue] `[inferred]`
- `POST` `/api/transactions/import` [auth, db, queue] `[inferred]`
- `PUT` `/api/users/:id/role` params(id) [auth, db] `[inferred]`
- `PUT` `/api/users/:id/active` params(id) [auth, db] `[inferred]`

---

# Components

- **App** — `client/src/App.jsx`
- **DonationReceiptsPdfDocument** — props: receipts — `client/src/components/DonationReceiptsPdfDocument.jsx`
- **ExpenseBreakdown** — props: lines, lineTotals, expenseAccountOptions, taxRateOptions, onChange, onRemove, errors, readOnly, showGrossColumn, minWidth — `client/src/components/ExpenseBreakdown.jsx`
- **FullScreenSpinner** — `client/src/components/FullScreenSpinner.jsx`
- **Layout** — `client/src/components/Layout.jsx`
- **ProtectedRoute** — `client/src/components/ProtectedRoute.jsx`
- **RoleGuard** — props: roles, fallback — `client/src/components/RoleGuard.jsx`
- **SaveTemplateModal** — props: isOpen, onClose, onSave, title, placeholder, Weekly Office Supplies' — `client/src/components/SaveTemplateModal.jsx`
- **TemplateDropdown** — props: templates, isOpen, onToggle, onLoad, onDelete — `client/src/components/TemplateDropdown.jsx`
- **AuthProvider** — `client/src/context/AuthContext.tsx`
- **DateProvider** — `client/src/context/DateContext.tsx`
- **GOOGLE_CLIENT_ID** — `client/src/main.jsx`
- **Bills** — `client/src/pages/Bills.jsx`
- **ChartOfAccounts** — `client/src/pages/ChartOfAccounts.jsx`
- **Contacts** — `client/src/pages/Contacts.jsx`
- **Dashboard** — `client/src/pages/Dashboard.jsx`
- **DepositEntry** — `client/src/pages/DepositEntry.jsx`
- **DonationReceipts** — `client/src/pages/DonationReceipts.jsx`
- **ExpenseEntry** — `client/src/pages/ExpenseEntry.jsx`
- **HardCloseWizard** — props: open, onClose, onSuccess — `client/src/pages/HardClose.jsx`
- **ImportCsv** — `client/src/pages/ImportCsv.jsx`
- **Login** — `client/src/pages/Login.jsx`
- **Reconciliation** — `client/src/pages/Reconciliation.jsx`
- **Reports** — `client/src/pages/Reports.jsx`
- **Settings** — `client/src/pages/Settings.jsx`
- **Transactions** — `client/src/pages/Transactions.jsx`
- **UserManagement** — `client/src/pages/UserManagement.jsx`

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
  - function useGenerateDonationReceipts: () => void
- `client/src/api/useExpenseTemplates.ts` — function useExpenseTemplates: () => void
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
- `client/src/api/useTransactionTemplates.ts` — function useTransactionTemplates: () => void
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
  - function generateReceipts: (fiscalYear, accountIds, markdownBody?) => Promise<DonationReceiptGenerateResponse>
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
- `client/vite.config.js`
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

- `server/db/index.js` — imported by **20** files
- `client/src/api/client.ts` — imported by **17** files
- `client/src/components/ui/Button.jsx` — imported by **16** files
- `server/middleware/auth.ts` — imported by **13** files
- `client/src/context/AuthContext.tsx` — imported by **12** files
- `client/src/components/ui/Input.jsx` — imported by **12** files
- `client/src/utils/date.ts` — imported by **11** files
- `client/src/components/ui/Toast.jsx` — imported by **11** files
- `client/src/components/ui/Card.jsx` — imported by **11** files
- `server/utils/date.ts` — imported by **11** files
- `client/src/components/ui/Select.jsx` — imported by **10** files
- `server/middleware/roles.ts` — imported by **10** files
- `client/src/api/useAccounts.ts` — imported by **9** files
- `client/src/components/ui/Combobox.jsx` — imported by **8** files
- `client/src/components/ui/Modal.jsx` — imported by **8** files
- `client/src/api/useFunds.ts` — imported by **7** files
- `server/services/churchTimeZone.ts` — imported by **7** files
- `server/types/db.ts` — imported by **7** files
- `client/src/components/ui/Table.jsx` — imported by **6** files
- `client/src/api/useContacts.ts` — imported by **6** files

## Import Map (who imports what)

- `server/db/index.js` ← `server/routes/accounts.ts`, `server/routes/auth.ts`, `server/routes/bills.ts`, `server/routes/contacts.ts`, `server/routes/fiscalPeriods.ts` +15 more
- `client/src/api/client.ts` ← `client/src/api/useAccounts.ts`, `client/src/api/useBills.ts`, `client/src/api/useContacts.ts`, `client/src/api/useDashboard.ts`, `client/src/api/useDonationReceipts.ts` +12 more
- `client/src/components/ui/Button.jsx` ← `client/src/components/SaveTemplateModal.jsx`, `client/src/components/TemplateDropdown.jsx`, `client/src/components/ui/TransactionTable.jsx`, `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx` +11 more
- `server/middleware/auth.ts` ← `server/routes/accounts.ts`, `server/routes/auth.ts`, `server/routes/bills.ts`, `server/routes/contacts.ts`, `server/routes/donationReceipts.ts` +8 more
- `client/src/context/AuthContext.tsx` ← `client/src/App.jsx`, `client/src/api/useExpenseTemplates.ts`, `client/src/api/useTransactionTemplates.ts`, `client/src/components/Layout.jsx`, `client/src/components/ProtectedRoute.jsx` +7 more
- `client/src/components/ui/Input.jsx` ← `client/src/components/ExpenseBreakdown.jsx`, `client/src/components/SaveTemplateModal.jsx`, `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx` +7 more
- `client/src/utils/date.ts` ← `client/src/api/useDashboard.ts`, `client/src/components/ui/DateRangePicker.jsx`, `client/src/components/ui/TransactionTable.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Dashboard.jsx` +6 more
- `client/src/components/ui/Toast.jsx` ← `client/src/main.jsx`, `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx`, `client/src/pages/DepositEntry.jsx` +6 more
- `client/src/components/ui/Card.jsx` ← `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx`, `client/src/pages/Dashboard.jsx`, `client/src/pages/DonationReceipts.jsx` +6 more
- `server/utils/date.ts` ← `server/routes/bills.ts`, `server/routes/fiscalPeriods.ts`, `server/routes/reconciliation.ts`, `server/routes/reports.ts`, `server/routes/settings.ts` +6 more

---

_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_