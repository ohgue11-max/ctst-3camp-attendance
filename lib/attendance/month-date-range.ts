/** D1 기준 year(1–12), month에 대한 [monthStart, nextMonthStart) ISO 날짜 문자열 */
export function getMonthIsoRange(year: number, month: number): { monthStart: string; nextMonthStart: string } {
  const pad2 = (n: number) => String(n).padStart(2, "0")
  const monthStart = `${year}-${pad2(month)}-01`
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextMonthStart = `${nextYear}-${pad2(nextMonth)}-01`
  return { monthStart, nextMonthStart }
}
