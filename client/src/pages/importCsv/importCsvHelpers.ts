import Decimal from 'decimal.js';

import type {
  BillMatchSuggestion,
  ContactSummary,
  ImportTransactionRow,
} from '@shared/contracts';
import type { ParsedImportRow, StatementRowMetadata } from './importCsvTypes';
import {
  buildDonorIndexes,
  isInteracEtransferPaymentMethod,
  isEtransferDescription,
  matchDonorFromSender,
} from '../../utils/etransferEnrich';

export const fmt = (n: Decimal.Value | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });

export const dec = (value: Decimal.Value | null | undefined) => {
  try {
    return new Decimal(value || 0);
  } catch {
    return new Decimal(0);
  }
};

function isEtransferDeposit(row: ImportTransactionRow, metadata?: StatementRowMetadata) {
  if (row.type !== 'deposit') return false;

  if (isInteracEtransferPaymentMethod(metadata?.payment_method)) {
    return true;
  }

  const fallbackDescription = [metadata?.description_1, metadata?.description_2].filter(Boolean).join(' — ');
  return isEtransferDescription(fallbackDescription);
}

function findMatchedDonorId(metadata: StatementRowMetadata | undefined, donorIndexes: ReturnType<typeof buildDonorIndexes>) {
  return matchDonorFromSender(metadata?.from, metadata?.sender, donorIndexes);
}

export function enrichParsedRows(
  rows: ImportTransactionRow[],
  metadata: StatementRowMetadata[],
  donorContacts: ContactSummary[],
  etransferOffsetId: number
): ParsedImportRow[] {
  const donorIndexes = buildDonorIndexes(donorContacts);

  return rows.map((row, i) => {
    const rowMetadata = metadata?.[i];
    const etransferPrefill = isEtransferDeposit(row, rowMetadata) ? etransferOffsetId : 0;
    const base: ParsedImportRow = { ...row, offset_account_id: etransferPrefill };
    if (row.type !== 'deposit') return base;
    if (!isEtransferDeposit(row, rowMetadata)) return base;

    const matchedId = findMatchedDonorId(rowMetadata, donorIndexes);
    if (matchedId) base.contact_id = matchedId;
    return base;
  });
}

export function groupBillSuggestions(suggestions: BillMatchSuggestion[] = []) {
  const grouped: Record<number, BillMatchSuggestion[]> = {};
  suggestions.forEach((suggestion) => {
    (grouped[suggestion.row_index] ??= []).push(suggestion);
  });
  return grouped;
}
