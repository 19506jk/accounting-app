import type { ContactSummary } from '@shared/contracts'

export const ETRANSFER_TOKENS = ['e-transfer', 'etransfer', 'interac e-transfer']
export const AUTODEPOSIT_DESC = 'e-transfer - autodeposit'

const normalize = (s: unknown) => String(s ?? '').trim().toLowerCase()

export function isEtransferDescription(description: string): boolean {
  const desc = normalize(description)
  return ETRANSFER_TOKENS.some((token) => desc.includes(token))
}

export function isAutodepositDescription(description: string): boolean {
  return normalize(description) === AUTODEPOSIT_DESC
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
