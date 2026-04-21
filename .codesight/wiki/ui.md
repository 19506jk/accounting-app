# UI

> **Navigation aid.** Component inventory and prop signatures extracted via AST. Read the source files before adding props or modifying component logic.

**40 components** (react)

## Components

- **App** — `client/src/App.tsx`
- **ExpenseBreakdown** — props: lines, lineTotals, expenseAccountOptions, taxRateOptions, onChange, onRemove, errors, readOnly, showGrossColumn, minWidth — `client/src/components/ExpenseBreakdown.tsx`
- **FullScreenSpinner** — `client/src/components/FullScreenSpinner.tsx`
- **Layout** — `client/src/components/Layout.tsx`
- **ProtectedRoute** — `client/src/components/ProtectedRoute.tsx`
- **RoleGuard** — props: roles, fallback — `client/src/components/RoleGuard.tsx`
- **SaveTemplateModal** — props: isOpen, onClose, onSave, title, placeholder — `client/src/components/SaveTemplateModal.tsx`
- **TemplateDropdown** — props: templates, isOpen, onToggle, onLoad, onDelete — `client/src/components/TemplateDropdown.tsx`
- **CreateFromBankRowModal** — props: bankTransaction, onClose, onSuccess — `client/src/components/bank/CreateFromBankRowModal.tsx`
- **AuthProvider** — `client/src/context/AuthContext.tsx`
- **DateProvider** — `client/src/context/DateContext.tsx`
- **GOOGLE_CLIENT_ID** — `client/src/main.tsx`
- **BankFeed** — `client/src/pages/BankFeed.tsx`
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
- **Reconciliation** — props: id, onBack, onExport, isExporting — `client/src/pages/Reconciliation.tsx`
- **Reports** — `client/src/pages/Reports.tsx`
- **Settings** — `client/src/pages/Settings.tsx`
- **Transactions** — props: onClose, onSaved — `client/src/pages/Transactions.tsx`
- **UserManagement** — `client/src/pages/UserManagement.tsx`
- **BankFeedImportTab** — props: isActive, bankAccountOptions, fundOptions, postImportNeedsReview, setPostImportNeedsReview — `client/src/pages/bankFeed/BankFeedImportTab.tsx`
- **BankFeedMatchTab** — props: isActive — `client/src/pages/bankFeed/BankFeedMatchTab.tsx`
- **BankFeedReviewTab** — props: isActive, onReviewed — `client/src/pages/bankFeed/BankFeedReviewTab.tsx`
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
_Back to [overview.md](./overview.md)_