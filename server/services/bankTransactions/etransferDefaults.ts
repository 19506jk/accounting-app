// E-transfer detection and default-description logic for the rule engine.
// Payment-method detection delegates to the same broad classifier used by
// the rest of the bank-feed pipeline (paymentMethods.ts).
//
// Description-based detection is kept in sync with client/src/utils/etransferEnrich.ts.

import { isETransferPaymentMethod } from './paymentMethods.js';

const ETRANSFER_TOKENS = ['e-transfer', 'etransfer', 'interac e-transfer'];

const normalize = (s: unknown): string => String(s ?? '').trim().toLowerCase();

function isEtransferDescription(description: string): boolean {
  const desc = normalize(description);
  return ETRANSFER_TOKENS.some((token) => desc.includes(token));
}

/**
 * Detect whether a bank row is an e-transfer deposit using the same
 * two-pronged check as the client:
 *   1. payment_method recognized by the broad e-transfer classifier, OR
 *   2. combined bank text contains an e-transfer token.
 */
function isEtransferDeposit(
  amount: number | string,
  payment_method: string | null | undefined,
  raw_description: string,
  bank_description_2: string | null | undefined,
): boolean {
  if (Number(amount) <= 0) return false;
  if (isETransferPaymentMethod(payment_method)) return true;
  const combined = [raw_description, bank_description_2].filter(Boolean).join(' — ');
  return isEtransferDescription(combined);
}

/**
 * Return the default description for a bank row that will be used when
 * creating a new transaction from an unmatched bank row.
 *
 * For deposit-side e-transfer rows with a non-empty bank_transaction_id
 * the reference number is used as the description.  Otherwise the current
 * server-side fallback (raw_description) is returned.
 */
export function defaultCreateDescription(
  amount: number | string,
  payment_method: string | null | undefined,
  raw_description: string,
  bank_description_2: string | null | undefined,
  bank_transaction_id: string | null | undefined,
): string {
  if (isEtransferDeposit(amount, payment_method, raw_description, bank_description_2) && bank_transaction_id?.trim()) {
    return bank_transaction_id;
  }
  return raw_description;
}
