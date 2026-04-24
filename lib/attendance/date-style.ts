import { isLegalHoliday, isWeekend, parseIsoDate } from "@/lib/attendance/holiday"

/**
 * work_date(YYYY-MM-DD) 기준: 토·일 + 법정 공휴일(EXTRA_LEGAL_HOLIDAYS 포함)이면 true
 */
export const isRedDate = (isoDate: string): boolean => {
  const parsed = parseIsoDate(isoDate)
  if (!parsed) return false
  return isWeekend(parsed) || isLegalHoliday(parsed)
}

/** 근태 표 날짜 컬럼: 주말·공휴일은 부드러운 빨강 + bold, 평일은 기본색·medium 유지 */
export const getDateTextClassName = (isoDate: string): string =>
  isRedDate(isoDate) ? "font-bold text-red-500" : "font-medium text-foreground"
