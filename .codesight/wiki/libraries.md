# Libraries

> **Navigation aid.** Library inventory extracted via AST. Read the source files listed here before modifying exported functions.

**37 library files** across 2 modules

## Client (20 files)

- `client/src/api/useBankTransactions.ts` — useBankTransactions, useBankUploads, useImportBankTransactions, useReviewBankTransaction, useScanCandidates, useReserve, …
- `client/src/utils/date.ts` — isValidTimeZone, setChurchTimeZone, getChurchTimeZone, parseDateOnlyStrict, toDateOnly, getChurchToday, …
- `client/src/api/useBills.ts` — useAvailableBillCredits, useBills, useBill, useBillSummary, useAgingReport, useCreateBill, …
- `client/src/api/useContacts.ts` — useContacts, useContact, useCreateContact, useUpdateContact, useDeleteContact, useDeactivateContact, …
- `client/src/api/useReconciliation.ts` — useReconciliations, useReconciliation, useCreateReconciliation, useUpdateReconciliation, useClearItem, useCloseReconciliation, …
- `client/src/api/useTransactions.ts` — useTransactions, useTransaction, useCreateTransaction, useUpdateTransaction, useDeleteTransaction, useImportTransactions, …
- `client/src/api/useReports.ts` — usePLReport, useBalanceSheetReport, useLedgerReport, useTrialBalanceReport, useDonorSummaryReport, useDonorDetailReport
- `client/src/utils/etransferEnrich.ts` — isEtransferDescription, isAutodepositDescription, buildDonorIndexes, matchDonorFromSender, ETRANSFER_TOKENS, AUTODEPOSIT_DESC
- `client/src/api/useDonationReceipts.ts` — useDonationReceiptAccounts, useDonationReceiptTemplate, useSaveDonationReceiptTemplate, usePreviewDonationReceipt, useGenerateDonationReceiptPdf
- `client/src/api/useUsers.ts` — useUsers, useCreateUser, useUpdateUserRole, useUpdateUserActive, useDeleteUser
- `client/src/api/useAccounts.ts` — useAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount
- `client/src/api/useFunds.ts` — useFunds, useCreateFund, useUpdateFund, useDeleteFund
- `client/src/api/useDashboard.ts` — usePLSummary, useBalanceSheet, useRecentTransactions
- `client/src/api/useExpenseTemplates.ts` — useExpenseTemplates, ExpenseTemplateRow, ExpenseTemplate
- `client/src/api/useTaxRates.ts` — useTaxRates, useUpdateTaxRate, useToggleTaxRate
- `client/src/api/useTransactionTemplates.ts` — useTransactionTemplates, TransactionTemplateRow, TransactionTemplate
- `client/src/api/useFiscalPeriods.ts` — useFiscalPeriods, useReopenFiscalPeriod
- `client/src/api/useSettings.ts` — useSettings, useUpdateSettings
- `client/src/utils/errors.ts` — getErrorMessage
- `client/src/utils/parseStatementCsv.ts` — parseStatementCsv

## Server (17 files)

- `server/utils/date.ts` — isValidTimeZone, parseDateOnlyStrict, isValidDateOnly, getChurchToday, addDaysDateOnly, compareDateOnly, …
- `server/services/bankTransactions/matcher.ts` — scoreRef, scoreDate, scoreDesc, writeBankTransactionEvent, confirmMatch, runMatcher
- `server/services/bills/billSettlement.ts` — getOutstanding, isSettledOutstanding, toBillStatus, buildBillSettlementPatch, formatBillReference, AP_ACCOUNT_CODE
- `server/services/bills/billPosting.ts` — getUniqueTaxRateIds, calculateGrossTotalFromLineItems, createMultiLineJournalEntries, TaxRateRow, ROUNDING_ACCOUNT_CODE
- `server/services/donationReceipts.ts` — getReceiptAccounts, getReceiptTemplate, saveReceiptTemplate, previewReceipt, generateReceiptPdf
- `server/services/donorDonations.ts` — getDonationLines, DonationLineFilters, DonationLineRow, DonationLine, Numeric
- `server/services/bills/billValidation.ts` — validateBillData, resolveTaxRateMap, validateLineItemAccounts, validateLineItemAccountsWithExecutor
- `server/services/bankTransactions/preflight.ts` — reconciliationReopenPreflight, ReconciliationReopenConflict, ReconciliationReopenPreflightResult
- `server/services/bankTransactions/reservations.ts` — acquireReservation, releaseReservation, AcquireReservationResult
- `server/services/bills/billCredits.ts` — getAvailableCreditsForBill, unapplyBillCredits, applyBillCredits
- `server/services/bills/billReadModel.ts` — normaliseApplications, getBillWithLineItems, ApplicationJoinedRow
- `server/services/churchTimeZone.ts` — getChurchTimeZone, setChurchTimeZone, initializeChurchTimeZoneCache
- `server/utils/hardCloseGuard.ts` — acquireHardCloseLock, assertNotClosedPeriod, HARD_CLOSE_LOCK_KEY
- `server/services/bankTransactions/normalize.ts` — normalizeDescription, buildFingerprint
- `server/services/bankTransactions/resolution.ts` — isResolved, resetRowState
- `server/services/bills/billReports.ts` — getAgingReport, getUnpaidSummary
- `server/services/bankTransactions/create.ts` — createFromBankRow

---
_Back to [overview.md](./overview.md)_