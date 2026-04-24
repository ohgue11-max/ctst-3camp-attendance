import Holidays from "date-holidays"

const krHolidays = new Holidays("KR")

/**
 * date-holidays(KR)에 없는 법정·임시 공휴일 등 (YYYY-MM-DD).
 * 필요 시 문자열만 추가하면 됩니다.
 */
export const EXTRA_LEGAL_HOLIDAYS: readonly string[] = []

const toKstDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return { year, month, day, mmdd: `${month}-${day}` }
}

export const isLegalHoliday = (date: Date, yearlyOverrides: Record<string, boolean> = {}): boolean => {
  const { year, mmdd } = toKstDate(date)
  const yyyyMmDd = `${year}-${mmdd}`
  if (yyyyMmDd in yearlyOverrides) return yearlyOverrides[yyyyMmDd]

  if (EXTRA_LEGAL_HOLIDAYS.includes(yyyyMmDd)) return true

  const holidayMatches = krHolidays.isHoliday(date)
  if (!holidayMatches) return false

  // 실무 집계 기준: 관공서 공휴일(공휴일/대체공휴일) + bank 성격 포함
  return holidayMatches.some((holiday) => holiday.type === "public" || holiday.type === "bank")
}

export const isWeekend = (date: Date): boolean => {
  const day = date.getDay()
  return day === 0 || day === 6
}

export const isWeekendOrHoliday = (date: Date, yearlyOverrides: Record<string, boolean> = {}): boolean =>
  isWeekend(date) || isLegalHoliday(date, yearlyOverrides)

export const parseIsoDate = (value: string): Date | null => {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  return date
}
