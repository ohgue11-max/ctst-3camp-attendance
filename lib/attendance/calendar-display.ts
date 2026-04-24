/**
 * 달력·근태 표에서 날짜 강조(토·일·법정 공휴일 + EXTRA) 판별.
 * 로직은 holiday / date-style에 두고 여기서 재노출해 확장 시 import 경로를 통일합니다.
 */
export { isRedDate as isHolidayOrWeekendDate, getDateTextClassName } from "@/lib/attendance/date-style"
