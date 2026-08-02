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
export function isEtransferDeposit(
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
 * Return the default transaction description for a bank row.
 *
 * Joins the two bank-description fields with an em-dash separator,
 * trimming and omitting blank values so the separator only appears
 * when both fields are present.
 */
export function defaultCreateDescription(
  _amount: number | string,
  _payment_method: string | null | undefined,
  raw_description: string,
  bank_description_2: string | null | undefined,
  _bank_transaction_id: string | null | undefined,
): string {
  const parts = [raw_description, bank_description_2]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);
  return parts.join(' — ');
}
