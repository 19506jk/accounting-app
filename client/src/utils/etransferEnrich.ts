import type { ContactSummary } from '@shared/contracts'

export const ETRANSFER_TOKENS = ['e-transfer', 'etransfer', 'interac e-transfer']

const normalize = (s: unknown) => String(s ?? '').trim().toLowerCase()

const ETRANSFER_PAYMENT_METHOD_MARKERS = ['interac', 'e-transfer', 'etransfer', 'e transfer', 'autodeposit', 'auto deposit'];

export function isInteracEtransferPaymentMethod(value: string | null | undefined): boolean {
  const v = normalize(value);
  if (!v) return false;
  return ETRANSFER_PAYMENT_METHOD_MARKERS.some((marker) => v.includes(marker));
}

export function isEtransferDescription(description: string): boolean {
  const desc = normalize(description)
  return ETRANSFER_TOKENS.some((token) => desc.includes(token))
}

/**
 * Return the default description for a bank row when creating a new
 * transaction from an unmatched row (no create_proposal).
 *
 * For deposit-side e-transfer rows with a non-empty bank_transaction_id
 * the reference number is used as the description.  Otherwise the current
 * joined fallback (raw_description + bank_description_2) is returned.
 */
export function defaultCreateDescription(
  amount: number,
  payment_method: string | null | undefined,
  raw_description: string,
  bank_description_2: string | null | undefined,
  bank_transaction_id: string | null | undefined,
): string {
  const joined = [raw_description, bank_description_2].filter(Boolean).join(' — ');

  if (amount > 0 && bank_transaction_id?.trim()) {
    if (isInteracEtransferPaymentMethod(payment_method)) return bank_transaction_id;
    if (isEtransferDescription(joined)) return bank_transaction_id;
  }

  return joined;
}

export function buildDonorIndexes(donorContacts: ContactSummary[]) {
  const donorByEmail = new Map<string, ContactSummary | null>()
  const donorByName = new Map<string, ContactSummary | null>()
  const householdEntries: Array<[string, ContactSummary]> = []

  for (const contact of donorContacts) {
    if (!contact.is_active) continue;

    if (contact.email) {
      const emailKey = normalize(contact.email)
      if (!donorByEmail.has(emailKey)) {
        donorByEmail.set(emailKey, contact)
      } else {
        const existing = donorByEmail.get(emailKey)
        if (!existing) continue
        if (contact.contact_class === 'HOUSEHOLD' && existing.contact_class !== 'HOUSEHOLD') {
          donorByEmail.set(emailKey, contact)
        } else if (contact.contact_class === existing.contact_class) {
          donorByEmail.set(emailKey, null)
        }
      }
    }

    const nameKey = normalize(contact.name)
    if (!donorByName.has(nameKey)) {
      donorByName.set(nameKey, contact)
    } else {
      const existing = donorByName.get(nameKey)
      if (!existing) continue
      if (contact.contact_class === 'HOUSEHOLD' && existing.contact_class !== 'HOUSEHOLD') {
        donorByName.set(nameKey, contact)
      } else if (contact.contact_class === existing.contact_class) {
        donorByName.set(nameKey, null)
      }
    }
  }

  for (const [nameKey, contact] of donorByName) {
    if (contact && contact.contact_class === 'HOUSEHOLD') {
      householdEntries.push([nameKey, contact])
    }
  }

  return { donorByEmail, donorByName, householdEntries }
}

export function matchDonorFromSender(
  senderEmail: string | null | undefined,
  senderName: string | null | undefined,
  donorIndexes: ReturnType<typeof buildDonorIndexes>
): number | null {
  const normalizedSenderEmail = normalize(senderEmail)
  const normalizedSenderName = normalize(senderName)
  const { donorByEmail, donorByName, householdEntries } = donorIndexes

  let matchedId: number | null = null

  if (normalizedSenderEmail) {
    const emailMatch = donorByEmail.get(normalizedSenderEmail)
    if (emailMatch) matchedId = emailMatch.id
  }

  if (!matchedId && normalizedSenderName) {
    const exactMatch = donorByName.get(normalizedSenderName)

    let householdPartialId: number | null = null
    let multipleHouseholdPartials = false
    for (const [nameKey, contact] of householdEntries) {
      if (nameKey === normalizedSenderName) continue
      if (nameKey && (normalizedSenderName.includes(nameKey) || nameKey.includes(normalizedSenderName))) {
        if (householdPartialId !== null) {
          multipleHouseholdPartials = true
          householdPartialId = null
          break
        }
        householdPartialId = contact.id
      }
    }

    if (householdPartialId && !multipleHouseholdPartials) {
      if (exactMatch && exactMatch.contact_class === 'HOUSEHOLD') {
        matchedId = exactMatch.id
      } else {
        matchedId = householdPartialId
      }
    } else if (exactMatch) {
      matchedId = exactMatch.id
    }
  }

  return matchedId
}
