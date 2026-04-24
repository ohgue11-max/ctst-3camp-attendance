/** 근태 조회 주·월·연 범위 (work_date YYYY-MM-DD 문자열 비교용) */

const pad2 = (n: number) => String(n).padStart(2, "0")

export type IsoDateRange = { startIso: string; endIso: string }

export function toIsoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 월요일 시작 주(로컬) — week 범위 */
export function getMondayStartOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay()
  const toMonday = (day + 6) % 7
  x.setDate(x.getDate() - toMonday)
  return x
}

export function getWeekRangeIso(anchor: Date): IsoDateRange {
  const start = getMondayStartOfWeek(anchor)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  return { startIso: toIsoDateLocal(start), endIso: toIsoDateLocal(end) }
}

export function getMonthRangeIso(year: number, month: number): IsoDateRange {
  const startIso = `${year}-${pad2(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endIso = `${year}-${pad2(month)}-${pad2(lastDay)}`
  return { startIso, endIso }
}

export function getYearRangeIso(year: number): IsoDateRange {
  return { startIso: `${year}-01-01`, endIso: `${year}-12-31` }
}

export function isIsoInRange(iso: string, range: IsoDateRange): boolean {
  return iso >= range.startIso && iso <= range.endIso
}

export type ViewMode = "week" | "month" | "year"
