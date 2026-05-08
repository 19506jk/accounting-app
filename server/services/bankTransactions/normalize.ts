import { createHash } from 'crypto';

export function normalizeDescription(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFingerprint(
  normalizedDesc: string,
  amount: number,
  date: string,
  refId?: string | null,
) {
  const formattedAmount = Number(amount).toFixed(2);
  const disambiguator = refId ? `|ref:${refId.toLowerCase().trim()}` : '';
  return createHash('sha256').update(`${normalizedDesc}|${formattedAmount}|${date}${disambiguator}`).digest('hex');
}
