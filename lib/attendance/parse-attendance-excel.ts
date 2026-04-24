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

const HEADER_ROW = 6
const DAY_START_ROW = 7
const DATE_COLUMN = "A"
const CHECK_IN_COLUMN = "B"
const CHECK_OUT_COLUMN = "C"
const LATE_COLUMN = "D"
const EARLY_LEAVE_COLUMN = "E"
const PERSONAL_ABSENCE_COLUMN = "F"
const OFFICIAL_ABSENCE_COLUMN = "G"
const NOTE_COLUMN = "H"

const YEAR_MONTH_RE = /(20\d{2})\D{0,3}(1[0-2]|0?[1-9])/

/** Excel 1900 날짜 체계 직렬값 → 로컬 자정에 가까운 Date (D1 월 헤더용) */
const excelSerialToDate = (serial: number): Date => {
  const ms = (serial - 25569) * 86400 * 1000
  return new Date(ms)
}

const matchYearMonthInString = (text: string): { year: number; month: number } | null => {
  const matched = text.match(YEAR_MONTH_RE)
  if (!matched) return null
  return { year: Number(matched[1]), month: Number(matched[2]) }
}

const tryYearMonthFromSheetCell = (
  sheet: XLSX.WorkSheet,
  address: string,
): { year: number; month: number } | null => {
  const cell = sheet[address] as XLSX.CellObject | undefined
  if (!cell) return null

  if (typeof cell.w === "string" && cell.w.trim()) {
    const fromW = matchYearMonthInString(cell.w.trim())
    if (fromW) return fromW
  }

  if (cell.v !== null && cell.v !== undefined) {
    if (typeof cell.v === "number" && Number.isFinite(cell.v) && cell.v > 20000 && cell.v < 120000) {
      const fromSerial = excelSerialToDate(cell.v)
      if (!Number.isNaN(fromSerial.getTime())) {
        return { year: fromSerial.getFullYear(), month: fromSerial.getMonth() + 1 }
      }
    }
    const fromV = matchYearMonthInString(String(cell.v).trim())
    if (fromV) return fromV
  }

  return null
}

const toCellAddress = (column: string, row: number) => `${column}${row}`

const readCellValue = (sheet: XLSX.WorkSheet, address: string) => {
  const cell = sheet[address]
  return cell?.v
}

/** 디버그용: XLSX가 보관한 원시 값(v)과 표시 문자(w) */
const readCellDebugSnapshot = (sheet: XLSX.WorkSheet, address: string) => {
  const cell = sheet[address] as XLSX.CellObject | undefined
  if (!cell) return { v: null as unknown, w: undefined as string | undefined }
  const w = typeof cell.w === "string" ? cell.w : undefined
  return { v: cell.v ?? null, w }
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

/** 양식 고정: 연·월은 D1만 사용 (없으면 현재 월). */
const getMonthInfo = (sheet: XLSX.WorkSheet) => {
  const now = new Date()
  const fromD1 = tryYearMonthFromSheetCell(sheet, "D1")
  if (fromD1) return fromD1
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  }
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

/** 업로드 경로 등에 쓰기 위해 워크북에서 연·월만 읽습니다. */
export const getAttendanceYearMonthFromWorkbook = (workbook: XLSX.WorkBook): { year: number; month: number } => {
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
  return getMonthInfo(workbook.Sheets[firstSheetName])
}

/**
 * 7행=1일 … 고정 행 구조: work_date는 A열이 아니라 행 슬롯(dayIndex)으로만 결정해
 * 같은 날짜가 두 행에 중복 매핑되는 문제를 막습니다. (엑셀 N행 → DB 1행)
 */
export const parseAttendanceWorkbook = (workbook: XLSX.WorkBook): ParsedAttendanceResult => {
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error("엑셀 시트를 찾을 수 없습니다.")
  }

  const sheet = workbook.Sheets[firstSheetName]
  const { year, month } = getMonthInfo(sheet)
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
    const addrA = toCellAddress(DATE_COLUMN, row)
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
    console.log("[excel-parse] row", row, "check_in", checkInRawValue, "check_out", checkOutRawValue)

    console.log("[excel-parse] row cells", {
      row,
      daySlot: dayIndex,
      headerRow: HEADER_ROW,
      dataStartRow: DAY_START_ROW,
      A: readCellDebugSnapshot(sheet, addrA),
      B: readCellDebugSnapshot(sheet, addrB),
      C: readCellDebugSnapshot(sheet, addrC),
      D: readCellDebugSnapshot(sheet, addrD),
      E: readCellDebugSnapshot(sheet, addrE),
      F: readCellDebugSnapshot(sheet, addrF),
      G: readCellDebugSnapshot(sheet, addrG),
      H: readCellDebugSnapshot(sheet, addrH),
    })

    if (dayIndex > maxDayInMonth) {
      continue
    }

    const day = dayIndex
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
