import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export const DEFAULT_CHURCH_TIMEZONE = 'America/Toronto';

const DATE_ONLY_FORMAT = 'YYYY-MM-DD';
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimeZone(value?: string | null) {
  if (!value) return false;
  try {
    Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function resolveTimeZone(timeZone?: string | null) {
  return isValidTimeZone(timeZone) ? String(timeZone) : DEFAULT_CHURCH_TIMEZONE;
}

export function parseDateOnlyStrict(value?: string | null) {
  if (!value || !DATE_ONLY_RE.test(value)) return null;
  const parsed = dayjs(value, DATE_ONLY_FORMAT, true);
  return parsed.isValid() ? parsed : null;
}

export function isValidDateOnly(value?: string | null) {
  return Boolean(parseDateOnlyStrict(value));
}

export function getChurchToday(timeZone?: string | null) {
  return dayjs().tz(resolveTimeZone(timeZone)).format(DATE_ONLY_FORMAT);
}

export function addDaysDateOnly(value: string, days: number, timeZone?: string | null) {
  const parsed = parseDateOnlyStrict(value);
  if (!parsed) return value;
  return parsed.tz(resolveTimeZone(timeZone), true).add(days, 'day').format(DATE_ONLY_FORMAT);
}

export function compareDateOnly(left?: string | null, right?: string | null) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeDateOnly(value: string | Date | null | undefined) {
  if (!value) return '';
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) return value;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format(DATE_ONLY_FORMAT) : '';
}

export function toUtcIsoString(value: string | Date) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.toISOString() : String(value);
}
