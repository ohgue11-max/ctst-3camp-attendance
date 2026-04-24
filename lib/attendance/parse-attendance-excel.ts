import { getDaysInMonth } from "date-fns"
import * as XLSX from "xlsx"
import { isLegalHoliday, isWeekend, parseIsoDate } from "@/lib/attendance/holiday"

type ParsedAttendanceRecord = {
  workDate: string
  checkInTime: string | null
  checkOutTime: string | null
  workMinutes: number
  isLate: boolean
  isUnder9h: boolean
  overtimeMinutes: number
  isSpecialWorkday: boolean
  isHoliday: boolean
  isWeekend: boolean
  attendanceStatus: string
}

type ParsedWarning = {
  workDate: string
  warningType: string
  warningMessage: string
  checkInRawValue: string | null
  checkOutRawValue: string | null
}

export type ParsedAttendanceResult = {
  year: number
  month: number
  records: ParsedAttendanceRecord[]
  warnings: ParsedWarning[]
}

const DAY_START_ROW = 7
const DATE_COLUMN = "A"
const CHECK_IN_COLUMN = "B"
const CHECK_OUT_COLUMN = "C"
const LATE_COLUMN = "D"
const EARLY_LEAVE_COLUMN = "E"
const PERSONAL_ABSENCE_COLUMN = "F"
const OFFICIAL_ABSENCE_COLUMN = "G"
const NOTE_COLUMN = "H"

const toCellAddress = (column: string, row: number) => `${column}${row}`

/** Excel 1900 날짜 체계 직렬값 → Date (엑셀 날짜 셀 파싱용) */
const excelSerialToDate = (serial: number): Date => {
  const ms = (serial - 25569) * 86400 * 1000
  return new Date(ms)
}

const isValidYmd = (year: number, month: number, day: number): boolean => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(year, month - 1, day)
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
}

const D1_YEAR_MONTH_ERROR = "D1 셀에서 근속년월(예: 2026-03)을 읽을 수 없어 업로드할 수 없습니다."

/**
 * D1 셀만 사용해 연·월을 읽습니다. (파일명 미사용)
 * 허용 예: 2026-03, 2026/03, 2026.03, 2026년 3월, Excel 날짜 직렬값
 */
export const parseYearMonthFromD1 = (sheet: XLSX.WorkSheet): { year: number; month: number } => {
  const cell = sheet.D1 as XLSX.CellObject | undefined
  if (!cell) {
    throw new Error(D1_YEAR_MONTH_ERROR)
  }

  const tryYearMonthString = (raw: string): { year: number; month: number } | null => {
    const t = raw.trim()
    if (!t) return null
    const ym = t.match(/^(\d{4})[-./](\d{1,2})$/)
    if (ym) {
      const year = Number(ym[1])
      const month = Number(ym[2])
      if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) return { year, month }
    }
    const korYm = t.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*$/)
    if (korYm) {
      const year = Number(korYm[1])
      const month = Number(korYm[2])
      if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) return { year, month }
    }
    return null
  }

  if (typeof cell.w === "string" && cell.w.trim()) {
    const fromW = tryYearMonthString(cell.w)
    if (fromW) return fromW
  }

  if (cell.v instanceof Date) {
    if (Number.isNaN(cell.v.getTime())) throw new Error(D1_YEAR_MONTH_ERROR)
    return { year: cell.v.getFullYear(), month: cell.v.getMonth() + 1 }
  }

  if (typeof cell.v === "string") {
    const fromV = tryYearMonthString(cell.v)
    if (fromV) return fromV
  }

  if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
    if (cell.v > 20000 && cell.v < 120000) {
      const d = excelSerialToDate(cell.v)
      if (Number.isNaN(d.getTime())) throw new Error(D1_YEAR_MONTH_ERROR)
      return { year: d.getFullYear(), month: d.getMonth() + 1 }
    }
  }

  throw new Error(D1_YEAR_MONTH_ERROR)
}

const readCellValue = (sheet: XLSX.WorkSheet, address: string) => {
  const cell = sheet[address]
  return cell?.v
}

/**
 * A열: 해당 월의 일(1~31) 숫자면 그 일로 매칭, 그렇지 않으면 행 슬롯(dayIndex) 사용.
 * 연·월은 D1 기준이며 A열은 행–일 매칭용입니다.
 */
const resolveDayOfMonthFromColumnA = (
  sheet: XLSX.WorkSheet,
  row: number,
  year: number,
  month: number,
  dayIndex: number,
): number => {
  const raw = readCellValue(sheet, toCellAddress(DATE_COLUMN, row))
  if (raw === null || raw === undefined) return dayIndex

  let day: number | null = null
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 31) {
    day = raw
  } else if (typeof raw === "string") {
    const trimmed = raw.trim()
    const m = trimmed.match(/^0*(\d{1,2})$/)
    if (m) day = Number(m[1])
  }

  if (day !== null && day >= 1 && day <= 31 && isValidYmd(year, month, day)) {
    return day
  }
  return dayIndex
}

const pad2 = (value: number) => String(value).padStart(2, "0")

/**
 * 출근(B)·퇴근(C)만 사용. HHMM "정확히 4자리 숫자"만 유효.
 * 예: 0809, 1710
 */
const parseStrictHhMmFromCell = (value: unknown): string | null => {
  if (value === null || value === undefined) return null

  let digits = ""

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    if (!Number.isInteger(value)) return null
    digits = String(value)
  } else if (typeof value === "string") {
    const t = value.trim()
    if (!t) return null
    if (!/^\d{4}$/.test(t)) return null
    digits = t
  } else {
    return null
  }

  if (digits.length !== 4 || !/^\d{4}$/.test(digits)) return null

  const hour = Number(digits.slice(0, 2))
  const minute = Number(digits.slice(2, 4))
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`
}

const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number)
  return hour * 60 + minute
}

const cellHasVisibleInput = (value: unknown): boolean => {
  if (value === null || value === undefined) return false
  if (typeof value === "string") return value.trim() !== ""
  if (typeof value === "number") return !Number.isNaN(value)
  return true
}

const formatRawCellValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    return String(value)
  }
  return String(value)
}

const isValidCheckInTime = (checkInTime: string): boolean => {
  const [hour, minute] = checkInTime.split(":").map(Number)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return false
  return hour >= 0 && hour <= 11 && minute >= 0 && minute <= 59
}

const extractTokens = (...values: Array<unknown>): string => values.map((v) => formatRawCellValue(v) ?? "").join(" ")

const hasKeyword = (text: string, keywords: string[]): boolean => keywords.some((keyword) => text.includes(keyword))

const deriveStatusTags = ({
  markerText,
  isSpecialWorkday,
  hasValidWorkTime,
  isLate,
  hasEarlyLeaveMarker,
  hasOvertime,
}: {
  markerText: string
  isSpecialWorkday: boolean
  hasValidWorkTime: boolean
  isLate: boolean
  hasEarlyLeaveMarker: boolean
  hasOvertime: boolean
}): string[] => {
  const tags = new Set<string>()

  if (hasKeyword(markerText, ["연차"])) tags.add("연차")
  if (hasKeyword(markerText, ["반차"])) tags.add("반차")
  if (hasKeyword(markerText, ["공가"])) tags.add("공가")
  if (hasKeyword(markerText, ["적치"])) tags.add("적치")
  if (hasKeyword(markerText, ["특근", "휴일근무"]) || (isSpecialWorkday && hasValidWorkTime)) tags.add("특근")
  if (hasKeyword(markerText, ["추가근무", "야간"]) || hasOvertime) tags.add("추가근무")
  if (hasEarlyLeaveMarker) tags.add("조퇴")
  if (isLate) tags.add("지각")
  if (hasValidWorkTime && tags.size === 0) tags.add("정상출근")

  return Array.from(tags)
}

/** 업로드 등: 첫 시트 D1에서 근속년월(예: 2026-03)을 읽습니다. 파일명은 사용하지 않습니다. */
export const getAttendanceYearMonthFromWorkbook = (workbook: XLSX.WorkBook): { year: number; month: number } => {
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error("엑셀 시트를 찾을 수 없습니다.")
  }
  return parseYearMonthFromD1(workbook.Sheets[firstSheetName])
}

/**
 * 7행=1일 … 고정 행 구조. 연·월은 D1만 사용하고,
 * 일자는 A열의 1~31 값이 있으면 매칭, 없으면 행 슬롯(dayIndex)을 사용합니다.
 */
export const parseAttendanceWorkbook = (workbook: XLSX.WorkBook): ParsedAttendanceResult => {
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error("엑셀 시트를 찾을 수 없습니다.")
  }

  const sheet = workbook.Sheets[firstSheetName]
  const { year, month } = parseYearMonthFromD1(sheet)
  const records: ParsedAttendanceRecord[] = []
  const warnings: ParsedWarning[] = []
  const warningDedup = new Set<string>()
  const recordDateDedup = new Set<string>()
  const maxDayInMonth = getDaysInMonth(new Date(year, month - 1, 1))

  const pushWarning = (warning: ParsedWarning) => {
    const warningKey = [
      warning.workDate,
      warning.warningType,
      warning.warningMessage,
      warning.checkInRawValue ?? "",
      warning.checkOutRawValue ?? "",
    ].join("|")
    if (warningDedup.has(warningKey)) return
    warningDedup.add(warningKey)
    warnings.push(warning)
  }

  for (let dayIndex = 1; dayIndex <= 31; dayIndex += 1) {
    const row = DAY_START_ROW + dayIndex - 1
    const addrB = toCellAddress(CHECK_IN_COLUMN, row)
    const addrC = toCellAddress(CHECK_OUT_COLUMN, row)
    const addrD = toCellAddress(LATE_COLUMN, row)
    const addrE = toCellAddress(EARLY_LEAVE_COLUMN, row)
    const addrF = toCellAddress(PERSONAL_ABSENCE_COLUMN, row)
    const addrG = toCellAddress(OFFICIAL_ABSENCE_COLUMN, row)
    const addrH = toCellAddress(NOTE_COLUMN, row)

    const lateRaw = readCellValue(sheet, addrD)
    const earlyLeaveRaw = readCellValue(sheet, addrE)
    const personalAbsenceRaw = readCellValue(sheet, addrF)
    const officialAbsenceRaw = readCellValue(sheet, addrG)
    const noteRaw = readCellValue(sheet, addrH)
    const checkInRaw = readCellValue(sheet, addrB)
    const checkOutRaw = readCellValue(sheet, addrC)
    const checkInRawValue = formatRawCellValue(checkInRaw)
    const checkOutRawValue = formatRawCellValue(checkOutRaw)
    const markerText = extractTokens(lateRaw, earlyLeaveRaw, personalAbsenceRaw, officialAbsenceRaw, noteRaw)

    if (dayIndex > maxDayInMonth) {
      continue
    }

    const day = resolveDayOfMonthFromColumnA(sheet, row, year, month, dayIndex)
    const workDate = `${year}-${pad2(month)}-${pad2(day)}`
    const workDateObj = parseIsoDate(workDate)
    const weekend = workDateObj ? isWeekend(workDateObj) : false
    const holiday = workDateObj ? isLegalHoliday(workDateObj) : false
    const isSpecialWorkday = weekend || holiday

    const checkInTime = parseStrictHhMmFromCell(checkInRaw)
    const checkOutTime = parseStrictHhMmFromCell(checkOutRaw)

    const hasAnyBOrC =
      cellHasVisibleInput(checkInRaw) ||
      cellHasVisibleInput(checkOutRaw)
    const hasAttendanceMarker = markerText.trim().length > 0

    if (!hasAnyBOrC && !hasAttendanceMarker) {
      continue
    }

    const hasLeaveStatus =
      hasKeyword(markerText, ["연차"]) ||
      hasKeyword(markerText, ["반차"]) ||
      hasKeyword(markerText, ["공가"]) ||
      hasKeyword(markerText, ["적치"])
    const hasEarlyLeaveMarker = cellHasVisibleInput(earlyLeaveRaw) || hasKeyword(markerText, ["조퇴"])

    if (!checkInTime || !checkOutTime) {
      if (hasLeaveStatus) {
        const statusTags = deriveStatusTags({
          markerText,
          isSpecialWorkday,
          hasValidWorkTime: false,
          isLate: false,
          hasEarlyLeaveMarker,
          hasOvertime: false,
        })
        if (!recordDateDedup.has(workDate)) {
          recordDateDedup.add(workDate)
          records.push({
            workDate,
            checkInTime: checkInTime ?? null,
            checkOutTime: checkOutTime ?? null,
            workMinutes: 0,
            isLate: false,
            isUnder9h: false,
            overtimeMinutes: 0,
            isSpecialWorkday: false,
            isHoliday: holiday,
            isWeekend: weekend,
            attendanceStatus: statusTags.join(", "),
          })
        }
        continue
      }
      pushWarning({
        workDate,
        warningType: "INCOMPLETE_TIME",
        warningMessage: "출근 또는 퇴근 시간이 비어 있거나 형식이 잘못되었습니다.",
        checkInRawValue,
        checkOutRawValue,
      })
      continue
    }

    if (!isValidCheckInTime(checkInTime)) {
      pushWarning({
        workDate,
        warningType: "INVALID_CHECK_IN_TIME",
        warningMessage: "출근 시간이 정상 범위를 벗어났습니다.",
        checkInRawValue,
        checkOutRawValue,
      })
      continue
    }

    const checkInMinutes = timeToMinutes(checkInTime)
    const checkOutMinutes = timeToMinutes(checkOutTime)

    if (checkOutMinutes <= checkInMinutes) {
      pushWarning({
        workDate,
        warningType: "INVALID_TIME_RANGE",
        warningMessage: "퇴근 시간이 출근 시간보다 빠르거나 같습니다.",
        checkInRawValue,
        checkOutRawValue,
      })
      continue
    }

    const workMinutes = checkOutMinutes - checkInMinutes
    const isLate = checkInMinutes > 9 * 60
    const isUnder9h = workMinutes < 9 * 60
    const overtimeMinutes = Math.max(0, workMinutes - 9 * 60)
    const hasOvertime = overtimeMinutes > 0
    const statusTags = deriveStatusTags({
      markerText,
      isSpecialWorkday,
      hasValidWorkTime: true,
      isLate,
      hasEarlyLeaveMarker,
      hasOvertime,
    })

    if (recordDateDedup.has(workDate)) {
      continue
    }
    recordDateDedup.add(workDate)
    records.push({
      workDate,
      checkInTime,
      checkOutTime,
      workMinutes,
      isLate,
      isUnder9h,
      overtimeMinutes,
      isSpecialWorkday,
      isHoliday: holiday,
      isWeekend: weekend,
      attendanceStatus: statusTags.join(", "),
    })
  }

  return {
    year,
    month,
    records,
    warnings,
  }
}

export const parseAttendanceExcelFromBuffer = async (
  buffer: ArrayBuffer,
): Promise<ParsedAttendanceResult> => {
  const workbook = XLSX.read(buffer, { type: "array" })
  return parseAttendanceWorkbook(workbook)
}

export const parseAttendanceExcel = async (file: File): Promise<ParsedAttendanceResult> => {
  const buffer = await file.arrayBuffer()
  return parseAttendanceExcelFromBuffer(buffer)
}
