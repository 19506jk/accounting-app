import { createHash } from 'crypto';

export function normalizeDescription(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFingerprint(normalizedDesc: string, amount: number, date: string) {
  const formattedAmount = Number(amount).toFixed(2);
  return createHash('sha256').update(`${normalizedDesc}|${formattedAmount}|${date}`).digest('hex');
}
