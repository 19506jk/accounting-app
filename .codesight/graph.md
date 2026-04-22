# Dependency Graph

## Most Imported Files (change these carefully)

- `server/db/index.js` — imported by **48** files
- `client/src/components/ui/types.ts` — imported by **29** files
- `client/src/components/ui/Button.tsx` — imported by **27** files
- `client/src/utils/errors.ts` — imported by **20** files
- `client/src/api/client.ts` — imported by **19** files
- `server/routes/routeTestHelpers.ts` — imported by **19** files
- `server/utils/date.ts` — imported by **18** files
- `client/src/utils/date.ts` — imported by **17** files
- `client/src/components/ui/Input.tsx` — imported by **17** files
- `client/src/components/ui/Toast.tsx` — imported by **17** files
- `server/middleware/auth.ts` — imported by **16** files
- `client/src/components/ui/Card.tsx` — imported by **15** files
- `client/src/components/ui/Combobox.tsx` — imported by **13** files
- `client/src/api/useAccounts.ts` — imported by **13** files
- `server/middleware/roles.ts` — imported by **13** files
- `client/src/context/AuthContext.tsx` — imported by **12** files
- `client/src/components/ui/Select.tsx` — imported by **12** files
- `server/services/churchTimeZone.ts` — imported by **12** files
- `client/src/components/ui/Modal.tsx` — imported by **11** files
- `server/types/db.ts` — imported by **10** files

## Import Map (who imports what)

- `server/db/index.js` ← `server/routes/__tests__/directDbAuth.integration.test.ts`, `server/routes/__tests__/directDbBankMatchingRules.integration.test.ts`, `server/routes/__tests__/directDbBankRuleEngine.integration.test.ts`, `server/routes/__tests__/directDbBankTransactions.integration.test.ts`, `server/routes/__tests__/directDbBankTransactionsPhase2.integration.test.ts` +43 more
- `client/src/components/ui/types.ts` ← `client/src/api/useExpenseTemplates.ts`, `client/src/components/ExpenseBreakdown.tsx`, `client/src/components/bank/BankMatchingRuleModal.tsx`, `client/src/components/bank/CreateFromBankRowModal.tsx`, `client/src/components/ui/Combobox.tsx` +24 more
- `client/src/components/ui/Button.tsx` ← `client/src/components/SaveTemplateModal.tsx`, `client/src/components/TemplateDropdown.tsx`, `client/src/components/bank/BankMatchingRuleModal.tsx`, `client/src/components/bank/CreateFromBankRowModal.tsx`, `client/src/components/ui/TransactionTable.tsx` +22 more
- `client/src/utils/errors.ts` ← `client/src/components/bank/BankMatchingRuleModal.tsx`, `client/src/components/bank/CreateFromBankRowModal.tsx`, `client/src/pages/Bills.tsx`, `client/src/pages/ChartOfAccounts.tsx`, `client/src/pages/Contacts.tsx` +15 more
- `client/src/api/client.ts` ← `client/src/api/useAccounts.ts`, `client/src/api/useBankMatchingRules.ts`, `client/src/api/useBankTransactions.ts`, `client/src/api/useBills.ts`, `client/src/api/useContacts.ts` +14 more
- `server/routes/routeTestHelpers.ts` ← `server/routes/__tests__/directDbAuth.integration.test.ts`, `server/routes/__tests__/directDbBankMatchingRules.integration.test.ts`, `server/routes/__tests__/directDbBankRuleEngine.integration.test.ts`, `server/routes/__tests__/directDbBankTransactions.integration.test.ts`, `server/routes/__tests__/directDbBankTransactionsPhase2.integration.test.ts` +14 more
- `server/utils/date.ts` ← `server/routes/bankTransactions.ts`, `server/routes/bills.ts`, `server/routes/fiscalPeriods.ts`, `server/routes/reconciliation.ts`, `server/routes/reports.ts` +13 more
- `client/src/utils/date.ts` ← `client/src/api/useDashboard.ts`, `client/src/components/ui/DateRangePicker.tsx`, `client/src/components/ui/TransactionTable.tsx`, `client/src/pages/Bills.tsx`, `client/src/pages/ChartOfAccounts.tsx` +12 more
- `client/src/components/ui/Input.tsx` ← `client/src/components/ExpenseBreakdown.tsx`, `client/src/components/SaveTemplateModal.tsx`, `client/src/components/bank/BankMatchingRuleModal.tsx`, `client/src/components/bank/CreateFromBankRowModal.tsx`, `client/src/pages/ChartOfAccounts.tsx` +12 more
- `client/src/components/ui/Toast.tsx` ← `client/src/components/bank/BankMatchingRuleModal.tsx`, `client/src/main.tsx`, `client/src/pages/Bills.tsx`, `client/src/pages/ChartOfAccounts.tsx`, `client/src/pages/Contacts.tsx` +12 more
