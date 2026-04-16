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
