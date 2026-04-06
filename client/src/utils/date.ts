import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

export const DEFAULT_CHURCH_TIMEZONE = 'America/Toronto'

const DATE_ONLY_FORMAT = 'YYYY-MM-DD'
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

let churchTimeZone = DEFAULT_CHURCH_TIMEZONE

export function isValidTimeZone(value?: string | null) {
  if (!value) return false
  try {
    Intl.DateTimeFormat('en-CA', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function setChurchTimeZone(value?: string | null) {
  churchTimeZone = isValidTimeZone(value) ? String(value) : DEFAULT_CHURCH_TIMEZONE
  return churchTimeZone
}

export function getChurchTimeZone() {
  return churchTimeZone
}

function resolveTimeZone(timeZone?: string | null) {
  return isValidTimeZone(timeZone) ? String(timeZone) : getChurchTimeZone()
}

export function parseDateOnlyStrict(value?: string | null) {
  if (!value || !DATE_ONLY_RE.test(value)) return null
  const parsed = dayjs(value, DATE_ONLY_FORMAT, true)
  return parsed.isValid() ? parsed : null
}

export function toDateOnly(value?: string | null) {
  if (!value) return ''
  if (DATE_ONLY_RE.test(value)) return value
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format(DATE_ONLY_FORMAT) : ''
}

export function getChurchToday(timeZone?: string | null) {
  return dayjs().tz(resolveTimeZone(timeZone)).format(DATE_ONLY_FORMAT)
}

export function addDaysDateOnly(value: string, days: number, timeZone?: string | null) {
  const parsed = parseDateOnlyStrict(value)
  if (!parsed) return value
  return parsed.tz(resolveTimeZone(timeZone), true).add(days, 'day').format(DATE_ONLY_FORMAT)
}

export function compareDateOnly(left?: string | null, right?: string | null) {
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

export function isDateOnlyBefore(left?: string | null, right?: string | null) {
  return compareDateOnly(left, right) < 0
}

export function formatDateOnlyForDisplay(value?: string | null) {
  return toDateOnly(value)
}

export function monthLabelInChurchZone(timeZone?: string | null) {
  return dayjs().tz(resolveTimeZone(timeZone)).format('MMMM YYYY')
}

export function currentMonthRange(timeZone?: string | null) {
  const now = dayjs().tz(resolveTimeZone(timeZone))
  return {
    from: now.startOf('month').format(DATE_ONLY_FORMAT),
    to: now.format(DATE_ONLY_FORMAT),
  }
}

export function lastMonthRange(timeZone?: string | null) {
  const now = dayjs().tz(resolveTimeZone(timeZone))
  const previousMonth = now.subtract(1, 'month')
  return {
    from: previousMonth.startOf('month').format(DATE_ONLY_FORMAT),
    to: previousMonth.endOf('month').format(DATE_ONLY_FORMAT),
  }
}

export function currentYearRange(timeZone?: string | null) {
  const now = dayjs().tz(resolveTimeZone(timeZone))
  return {
    from: now.startOf('year').format(DATE_ONLY_FORMAT),
    to: now.format(DATE_ONLY_FORMAT),
  }
}

export function currentYearValue(timeZone?: string | null) {
  return dayjs().tz(resolveTimeZone(timeZone)).year()
}
