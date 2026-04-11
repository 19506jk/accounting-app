# Dependency Graph

## Most Imported Files (change these carefully)

- `client/src/api/client.ts` — imported by **14** files
- `server/db/index.js` — imported by **13** files
- `client/src/components/ui/Toast.jsx` — imported by **11** files
- `client/src/components/ui/Button.jsx` — imported by **11** files
- `server/middleware/auth.ts` — imported by **11** files
- `client/src/context/AuthContext.tsx` — imported by **10** files
- `client/src/utils/date.ts` — imported by **10** files
- `client/src/components/ui/Card.jsx` — imported by **10** files
- `client/src/components/ui/Input.jsx` — imported by **10** files
- `client/src/api/useAccounts.ts` — imported by **9** files
- `server/middleware/roles.ts` — imported by **9** files
- `client/src/api/useFunds.ts` — imported by **7** files
- `client/src/components/ui/Select.jsx` — imported by **7** files
- `client/src/components/ui/Combobox.jsx` — imported by **7** files
- `server/utils/date.ts` — imported by **7** files
- `client/src/api/useContacts.ts` — imported by **6** files
- `client/src/components/ui/Table.jsx` — imported by **6** files
- `client/src/components/ui/Modal.jsx` — imported by **6** files
- `client/src/components/ui/Badge.jsx` — imported by **5** files
- `server/services/churchTimeZone.ts` — imported by **5** files

## Import Map (who imports what)

- `client/src/api/client.ts` ← `client/src/api/useAccounts.ts`, `client/src/api/useBills.ts`, `client/src/api/useContacts.ts`, `client/src/api/useDashboard.ts`, `client/src/api/useFunds.ts` +9 more
- `server/db/index.js` ← `server/routes/accounts.ts`, `server/routes/auth.ts`, `server/routes/bills.ts`, `server/routes/contacts.ts`, `server/routes/funds.ts` +8 more
- `client/src/components/ui/Toast.jsx` ← `client/src/main.jsx`, `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx`, `client/src/pages/DepositEntry.jsx` +6 more
- `client/src/components/ui/Button.jsx` ← `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx`, `client/src/pages/DepositEntry.jsx`, `client/src/pages/ExpenseEntry.jsx` +6 more
- `server/middleware/auth.ts` ← `server/routes/accounts.ts`, `server/routes/auth.ts`, `server/routes/bills.ts`, `server/routes/contacts.ts`, `server/routes/funds.ts` +6 more
- `client/src/context/AuthContext.tsx` ← `client/src/App.jsx`, `client/src/components/Layout.jsx`, `client/src/components/ProtectedRoute.jsx`, `client/src/components/RoleGuard.jsx`, `client/src/context/DateContext.tsx` +5 more
- `client/src/utils/date.ts` ← `client/src/api/useDashboard.ts`, `client/src/components/ui/DateRangePicker.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Dashboard.jsx`, `client/src/pages/DepositEntry.jsx` +5 more
- `client/src/components/ui/Card.jsx` ← `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx`, `client/src/pages/Dashboard.jsx`, `client/src/pages/ImportCsv.jsx` +5 more
- `client/src/components/ui/Input.jsx` ← `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/Contacts.jsx`, `client/src/pages/DepositEntry.jsx`, `client/src/pages/ExpenseEntry.jsx` +5 more
- `client/src/api/useAccounts.ts` ← `client/src/pages/Bills.jsx`, `client/src/pages/ChartOfAccounts.jsx`, `client/src/pages/DepositEntry.jsx`, `client/src/pages/ExpenseEntry.jsx`, `client/src/pages/ImportCsv.jsx` +4 more
