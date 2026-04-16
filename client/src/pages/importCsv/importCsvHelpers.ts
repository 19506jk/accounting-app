import Decimal from 'decimal.js';

import type {
  BillMatchSuggestion,
  ContactSummary,
  ImportTransactionRow,
} from '@shared/contracts';
import type { ParsedImportRow, StatementRowMetadata } from './importCsvTypes';

const AUTODEPOSIT_DESC = 'e-transfer - autodeposit';
const ETRANSFER_TOKENS = ['e-transfer', 'etransfer', 'interac e-transfer'];

export const fmt = (n: Decimal.Value | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });

export const dec = (value: Decimal.Value | null | undefined) => {
  try {
    return new Decimal(value || 0);
  } catch {
    return new Decimal(0);
  }
};

const normalize = (s: unknown) => String(s ?? '').trim().toLowerCase();

function isEtransferDeposit(row: ImportTransactionRow, metadata?: StatementRowMetadata) {
  if (row.type !== 'deposit') return false;
  const desc = normalize(metadata?.description_1);
  return ETRANSFER_TOKENS.some((token) => desc.includes(token));
}

function buildDonorIndexes(donorContacts: ContactSummary[]) {
  const donorByEmail = new Map<string, ContactSummary | null>();
  const donorByName = new Map<string, ContactSummary | null>();
  const householdEntries: Array<[string, ContactSummary]> = [];

  for (const contact of donorContacts) {
    if (!contact.is_active) continue;

    if (contact.email) {
      const emailKey = normalize(contact.email);
      if (!donorByEmail.has(emailKey)) {
        donorByEmail.set(emailKey, contact);
      } else {
        const existing = donorByEmail.get(emailKey);
        if (!existing) continue;
        if (contact.contact_class === 'HOUSEHOLD' && existing.contact_class !== 'HOUSEHOLD') {
          donorByEmail.set(emailKey, contact);
        } else if (contact.contact_class === existing.contact_class) {
          donorByEmail.set(emailKey, null);
        }
      }
    }

    const nameKey = normalize(contact.name);
    if (!donorByName.has(nameKey)) {
      donorByName.set(nameKey, contact);
    } else {
      const existing = donorByName.get(nameKey);
      if (!existing) continue;
      if (contact.contact_class === 'HOUSEHOLD' && existing.contact_class !== 'HOUSEHOLD') {
        donorByName.set(nameKey, contact);
      } else if (contact.contact_class === existing.contact_class) {
        donorByName.set(nameKey, null);
      }
    }
  }

  for (const [nameKey, contact] of donorByName) {
    if (contact && contact.contact_class === 'HOUSEHOLD') {
      householdEntries.push([nameKey, contact]);
    }
  }

  return { donorByEmail, donorByName, householdEntries };
}

function findMatchedDonorId(metadata: StatementRowMetadata | undefined, donorIndexes: ReturnType<typeof buildDonorIndexes>) {
  const fromEmail = normalize(metadata?.from);
  const senderName = normalize(metadata?.sender);
  const { donorByEmail, donorByName, householdEntries } = donorIndexes;

  let matchedId: number | null = null;

  if (fromEmail) {
    const emailMatch = donorByEmail.get(fromEmail);
    if (emailMatch) matchedId = emailMatch.id;
  }

  if (!matchedId && senderName) {
    const exactMatch = donorByName.get(senderName);

    let householdPartialId: number | null = null;
    let multipleHouseholdPartials = false;
    for (const [nameKey, contact] of householdEntries) {
      if (nameKey === senderName) continue;
      if (nameKey && (senderName.includes(nameKey) || nameKey.includes(senderName))) {
        if (householdPartialId !== null) {
          multipleHouseholdPartials = true;
          householdPartialId = null;
          break;
        }
        householdPartialId = contact.id;
      }
    }

    if (householdPartialId && !multipleHouseholdPartials) {
      if (exactMatch && exactMatch.contact_class === 'HOUSEHOLD') {
        matchedId = exactMatch.id;
      } else {
        matchedId = householdPartialId;
      }
    } else if (exactMatch) {
      matchedId = exactMatch.id;
    }
  }

  return matchedId;
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
    if (normalize(rowMetadata?.description_1) !== AUTODEPOSIT_DESC) return base;

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
