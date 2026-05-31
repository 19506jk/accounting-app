export function isInteracPaymentMethod(paymentMethod: string | null | undefined) {
  // Kept narrow: only Interac transactions carry a unique bank_transaction_id for fingerprinting.
  return paymentMethod?.trim().toLowerCase().includes('interac') ?? false;
}

export function isETransferPaymentMethod(paymentMethod: string | null | undefined) {
  const normalized = paymentMethod?.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes('interac')
    || normalized.includes('e-transfer')
    || normalized.includes('etransfer')
    || normalized.includes('e transfer')
    || normalized.includes('autodeposit')
    || normalized.includes('auto deposit');
}

export function toEntryPaymentMethod(paymentMethod: string | null | undefined) {
  return isETransferPaymentMethod(paymentMethod) ? 'e-transfer' : null;
}
