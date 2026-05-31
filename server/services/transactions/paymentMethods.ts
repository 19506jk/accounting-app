import type { PaymentMethod } from '@shared/contracts';

export const PAYMENT_METHODS = ['cash', 'cheque', 'e-transfer'] as const satisfies readonly PaymentMethod[];

export const VALID_PAYMENT_METHODS = new Set<string>(PAYMENT_METHODS);

export function isValidPaymentMethod(value: string | null | undefined): value is PaymentMethod {
  return value != null && VALID_PAYMENT_METHODS.has(value);
}

export function formatPaymentMethodList() {
  return PAYMENT_METHODS.join(', ');
}
