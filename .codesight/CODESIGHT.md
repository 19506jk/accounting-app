# accounting-app — AI Context Map

> **Stack:** raw-http | none | unknown | javascript

> 0 routes | 0 models | 0 components | 17 lib files | 13 env vars | 7 middleware | 262 import links
> **Token savings:** this file is ~2,300 tokens. Without it, AI exploration would cost ~17,000 tokens. **Saves ~14,800 tokens per conversation.**

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
- `client/src/api/useExpenseTemplates.ts` — function useExpenseTemplates: () => void
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
- `server/services/churchTimeZone.ts`
  - function getChurchTimeZone: () => void
  - function setChurchTimeZone: (value?) => void
  - function initializeChurchTimeZoneCache: () => void
- `server/utils/date.ts`
  - function isValidTimeZone: (value?) => void
  - function parseDateOnlyStrict: (value?) => void
  - function isValidDateOnly: (value?) => void
  - function getChurchToday: (timeZone?) => void
  - function addDaysDateOnly: (value, days, timeZone?) => void
  - function compareDateOnly: (left?, right?) => void
  - _...3 more_

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

## cors
- cors — `server/index.ts`

---

# Dependency Graph

## Most Imported Files (change these carefully)

- `client/src/api/client.ts` — imported by **14** files
- `client/src/components/ui/Button.jsx` — imported by **14** files
- `server/db/index.js` — imported by **13** files
- `client/src/context/AuthContext.tsx` — imported by **12** files
- `client/src/components/ui/Input.jsx` — imported by **12** files
- `client/src/utils/date.ts` — imported by **11** files
- `client/src/components/ui/Toast.jsx` — imported by **11** files
- `server/middleware/auth.ts` — imported by **11** files
- `client/src/components/ui/Card.jsx` — imported by **10** files
- `client/src/components/ui/Select.jsx` — imported by **9** files
- `client/src/api/useAccounts.ts` — imported by **9** files
- `server/middleware/roles.ts` — imported by **9** files
- `client/src/components/ui/Combobox.jsx` — imported by **8** files
- `client/src/components/ui/Modal.jsx` — imported by **7** files
- `client/src/api/useFunds.ts` — imported by **7** files
- `server/utils/date.ts` — imported by **7** files
- `client/src/api/useContacts.ts` — imported by **6** files
- `client/src/components/ui/Table.jsx` — imported by **5** files
- `client/src/components/ui/Badge.jsx` — imported by **5** files
- `server/services/churchTimeZone.ts` — imported by **5** files

## Import Map (who imports what)

- `client/src/api/client.ts` ← `client/src/api/useAccounts.ts`, `client/src/api/useBills.ts`, `client/src/api/useContacts.ts`, `client/src/api/useDashboard.ts`, `client/src/api/useFunds.ts` +9 more
- `client/src/components/ui/Button.jsx` ← `client/src/components/SaveTemplateModal.jsx`, `client/src/components/TemplateDropdown.jsx`, `client/src/components/ui/TransactionTable.jsx`, `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx` +9 more
- `server/db/index.js` ← `server/routes/accounts.ts`, `server/routes/auth.ts`, `server/routes/bills.ts`, `server/routes/contacts.ts`, `server/routes/funds.ts` +8 more
- `client/src/context/AuthContext.tsx` ← `client/src/App.jsx`, `client/src/api/useExpenseTemplates.ts`, `client/src/api/useTransactionTemplates.ts`, `client/src/components/Layout.jsx`, `client/src/components/ProtectedRoute.jsx` +7 more
- `client/src/components/ui/Input.jsx` ← `client/src/components/ExpenseBreakdown.jsx`, `client/src/components/SaveTemplateModal.jsx`, `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx` +7 more
- `client/src/utils/date.ts` ← `client/src/api/useDashboard.ts`, `client/src/components/ui/DateRangePicker.jsx`, `client/src/components/ui/TransactionTable.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Dashboard.jsx` +6 more
- `client/src/components/ui/Toast.jsx` ← `client/src/main.jsx`, `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx`, `client/src/pages/DepositEntry.jsx` +6 more
- `server/middleware/auth.ts` ← `server/routes/accounts.ts`, `server/routes/auth.ts`, `server/routes/bills.ts`, `server/routes/contacts.ts`, `server/routes/funds.ts` +6 more
- `client/src/components/ui/Card.jsx` ← `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx`, `client/src/pages/Dashboard.jsx`, `client/src/pages/ImportCsv.jsx` +5 more
- `client/src/components/ui/Select.jsx` ← `client/src/components/ExpenseBreakdown.jsx`, `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx`, `client/src/pages/Reconciliation.jsx` +4 more

---

_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_