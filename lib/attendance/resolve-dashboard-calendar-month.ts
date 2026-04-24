const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * attendance / warnings 등에서 수집한 work_date(YYYY-MM-DD) 중
 * 가장 늦은 날짜의 연·월을 달력 앵커로 사용합니다. 없으면 `fallback` 또는 오늘.
 */
export function resolveDashboardCalendarMonth(
  dates: Iterable<string>,
  fallback?: { year: number; month: number },
): { year: number; month: number } {
  let max: string | null = null
  for (const d of dates) {
    if (!ISO_DATE_RE.test(d)) continue
    if (max === null || d > max) max = d
  }
  if (max === null) {
    if (fallback) return fallback
    const n = new Date()
    return { year: n.getFullYear(), month: n.getMonth() + 1 }
  }
  const year = Number(max.slice(0, 4))
  const month = Number(max.slice(5, 7))
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    const n = new Date()
    return { year: n.getFullYear(), month: n.getMonth() + 1 }
  }
  return { year, month }
}
