# Libraries

> **Navigation aid.** Library inventory extracted via AST. Read the source files listed here before modifying exported functions.

**28 library files** across 2 modules

## Client (17 files)

- `client/src/utils/date.ts` — isValidTimeZone, setChurchTimeZone, getChurchTimeZone, parseDateOnlyStrict, toDateOnly, getChurchToday, …
- `client/src/api/useBills.ts` — useAvailableBillCredits, useBills, useBill, useBillSummary, useAgingReport, useCreateBill, …
- `client/src/api/useContacts.ts` — useContacts, useContact, useCreateContact, useUpdateContact, useDeleteContact, useDeactivateContact, …
- `client/src/api/useReconciliation.ts` — useReconciliations, useReconciliation, useCreateReconciliation, useUpdateReconciliation, useClearItem, useCloseReconciliation, …
- `client/src/api/useTransactions.ts` — useTransactions, useTransaction, useCreateTransaction, useUpdateTransaction, useDeleteTransaction, useImportTransactions, …
- `client/src/api/useReports.ts` — usePLReport, useBalanceSheetReport, useLedgerReport, useTrialBalanceReport, useDonorSummaryReport, useDonorDetailReport
- `client/src/api/useDonationReceipts.ts` — useDonationReceiptAccounts, useDonationReceiptTemplate, useSaveDonationReceiptTemplate, usePreviewDonationReceipt, useGenerateDonationReceipts
- `client/src/api/useUsers.ts` — useUsers, useCreateUser, useUpdateUserRole, useUpdateUserActive, useDeleteUser
- `client/src/api/useAccounts.ts` — useAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount
- `client/src/api/useFunds.ts` — useFunds, useCreateFund, useUpdateFund, useDeleteFund
- `client/src/api/useDashboard.ts` — usePLSummary, useBalanceSheet, useRecentTransactions
- `client/src/api/useTaxRates.ts` — useTaxRates, useUpdateTaxRate, useToggleTaxRate
- `client/src/api/useFiscalPeriods.ts` — useFiscalPeriods, useReopenFiscalPeriod
- `client/src/api/useSettings.ts` — useSettings, useUpdateSettings
- `client/src/api/useExpenseTemplates.ts` — useExpenseTemplates
- `client/src/api/useTransactionTemplates.ts` — useTransactionTemplates
- `client/src/utils/parseStatementCsv.ts` — parseStatementCsv

## Server (11 files)

- `server/utils/date.ts` — isValidTimeZone, parseDateOnlyStrict, isValidDateOnly, getChurchToday, addDaysDateOnly, compareDateOnly, …
- `server/services/bills/billSettlement.ts` — getOutstanding, isSettledOutstanding, toBillStatus, buildBillSettlementPatch, formatBillReference, AP_ACCOUNT_CODE
- `server/services/bills/billPosting.ts` — getUniqueTaxRateIds, calculateGrossTotalFromLineItems, createMultiLineJournalEntries, TaxRateRow, ROUNDING_ACCOUNT_CODE
- `server/services/donationReceipts.ts` — getReceiptAccounts, getReceiptTemplate, saveReceiptTemplate, previewReceipt, generateReceipts
- `server/services/donorDonations.ts` — getDonationLines, DonationLineFilters, DonationLineRow, DonationLine, Numeric
- `server/services/bills/billCredits.ts` — getAvailableCreditsForBill, unapplyBillCredits, applyBillCredits
- `server/services/bills/billReadModel.ts` — normaliseApplications, getBillWithLineItems, ApplicationJoinedRow
- `server/services/bills/billValidation.ts` — validateBillData, resolveTaxRateMap, validateLineItemAccounts
- `server/services/churchTimeZone.ts` — getChurchTimeZone, setChurchTimeZone, initializeChurchTimeZoneCache
- `server/utils/hardCloseGuard.ts` — acquireHardCloseLock, assertNotClosedPeriod, HARD_CLOSE_LOCK_KEY
- `server/services/bills/billReports.ts` — getAgingReport, getUnpaidSummary

---
_Back to [overview.md](./overview.md)_