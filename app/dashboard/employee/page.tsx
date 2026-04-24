"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { useDashboardUserName } from "@/components/layout/dashboard-user-context"
import { StatCard } from "@/components/dashboard/stat-card"
import {
  AttendanceTable,
  type AttendanceRecord,
  type AttendanceStatusBadgeLabel,
} from "@/components/dashboard/attendance-table"
import { AttendanceMiniCalendar } from "@/components/dashboard/attendance-mini-calendar"
import { UploadCard } from "@/components/upload/upload-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import * as XLSX from "xlsx"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { getDateTextClassName } from "@/lib/attendance/calendar-display"
import { isLegalHoliday, isWeekend, parseIsoDate } from "@/lib/attendance/holiday"
import { resolveDashboardCalendarMonth } from "@/lib/attendance/resolve-dashboard-calendar-month"
import {
  getMonthRangeIso,
  getWeekRangeIso,
  getYearRangeIso,
  isIsoInRange,
  type ViewMode,
} from "@/lib/attendance/view-period"
import {
  Calendar,
  Clock,
  AlertTriangle,
  TrendingUp,
  BriefcaseBusiness,
  CalendarCheck2,
  ClipboardList,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

function EmployeeDashboardGreeting() {
  const displayName = useDashboardUserName()
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">{displayName}님 행복하세요 😊</h1>
      <p className="text-muted-foreground mt-1">오늘도 좋은 하루 되세요.</p>
    </div>
  )
}

type AttendanceRecordRow = {
  work_date: string
  check_in: string | null
  check_out: string | null
  total_minutes: number | null
  is_late: boolean | null
  is_under_9h: boolean | null
  overtime_minutes: number | null
  is_special_workday?: boolean | null
  work_status?: string | null
}

type WarningItem = {
  workDate: string
  warningType: string
  message: string
}

type AttendanceExportRow = {
  user_id: string
  work_date: string
  check_in: string | null
  check_out: string | null
  total_minutes: number | null
}

type ProfileNameRow = {
  id: string
  name: string | null
}

type StatusKind = "SPECIAL_WORK" | "OVERTIME" | "LATE" | null

const TEMPLATE_FILE_PATH = "/templates/3월 3Camp 기술팀 출근부.xlsx"
const TITLE_CELL = "A5"
const TEMPLATE_DATE_START_ROW = 8
const TEMPLATE_DATE_END_ROW = 38
const DATE_COLUMN = "A"
const WEEKDAY_COLUMN = "B"

const EMPLOYEE_COLUMN_MAP: Record<string, { checkInCol: string; checkOutCol: string }> = {
  장영광: { checkInCol: "C", checkOutCol: "D" },
  심종하: { checkInCol: "E", checkOutCol: "F" },
  오민석: { checkInCol: "G", checkOutCol: "H" },
  권태준: { checkInCol: "I", checkOutCol: "J" },
  김정훈: { checkInCol: "K", checkOutCol: "L" },
  이민성: { checkInCol: "M", checkOutCol: "N" },
  김희수: { checkInCol: "O", checkOutCol: "P" },
  김선태: { checkInCol: "Q", checkOutCol: "R" },
  이주남: { checkInCol: "S", checkOutCol: "T" },
}

const STATUS_COLOR: Record<Exclude<StatusKind, null>, string> = {
  SPECIAL_WORK: "F97316", // 특근
  OVERTIME: "A855F7", // 추가근무
  LATE: "EF4444", // 지각
}

const parseTimeToMinutes = (time: string | null): number | null => {
  if (!time) return null
  const text = String(time).trim()
  if (!text) return null

  if (/^\d{4}$/.test(text)) {
    const hour = Number(text.slice(0, 2))
    const minute = Number(text.slice(2, 4))
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return hour * 60 + minute
  }

  const colon = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!colon) return null
  const hour = Number(colon[1])
  const minute = Number(colon[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

const minutesToHhMm = (minutes: number | null): string => {
  if (minutes === null) return ""
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

const pad2 = (value: number) => String(value).padStart(2, "0")
const toValidSheetName = (value: string): string => {
  const sanitized = value.replace(/[\\/?*[\]:]/g, " ").trim()
  const fallback = "근태시트"
  return (sanitized || fallback).slice(0, 31)
}

const ensureCell = (sheet: XLSX.WorkSheet, address: string): XLSX.CellObject => {
  const existing = sheet[address] as XLSX.CellObject | undefined
  if (existing) return existing
  const created: XLSX.CellObject = { t: "s", v: "" }
  sheet[address] = created
  return created
}

const setCellString = (sheet: XLSX.WorkSheet, address: string, value: string) => {
  const cell = ensureCell(sheet, address)
  cell.t = "s"
  cell.v = value
}

const setCellNumber = (sheet: XLSX.WorkSheet, address: string, value: number) => {
  const cell = ensureCell(sheet, address)
  cell.t = "n"
  cell.v = value
}

const clearCellValue = (sheet: XLSX.WorkSheet, address: string) => {
  const cell = ensureCell(sheet, address)
  cell.t = "s"
  cell.v = ""
}

const applyPriorityColor = (sheet: XLSX.WorkSheet, address: string, rgb: string) => {
  const cell = ensureCell(sheet, address)
  const prevStyle = typeof cell.s === "object" && cell.s !== null ? (cell.s as Record<string, unknown>) : {}
  cell.s = {
    ...prevStyle,
    fill: {
      patternType: "solid",
      fgColor: { rgb },
      bgColor: { rgb },
    },
  }
}

const applyRedDateFont = (sheet: XLSX.WorkSheet, address: string) => {
  const cell = ensureCell(sheet, address)
  const prevStyle = typeof cell.s === "object" && cell.s !== null ? (cell.s as Record<string, unknown>) : {}
  const prevFont =
    prevStyle.font && typeof prevStyle.font === "object" ? (prevStyle.font as Record<string, unknown>) : {}
  cell.s = {
    ...prevStyle,
    font: {
      ...prevFont,
      color: { rgb: "DC2626" },
    },
  }
}

const resolveStatusKind = ({
  checkInMinutes,
  checkOutMinutes,
  totalMinutes,
  workDate,
}: {
  checkInMinutes: number | null
  checkOutMinutes: number | null
  totalMinutes: number | null
  workDate: string
}): StatusKind => {
  if (checkInMinutes === null || checkOutMinutes === null || checkOutMinutes <= checkInMinutes) {
    return null
  }
  const parsedDate = parseIsoDate(workDate)
  const isSpecialDay = parsedDate ? isWeekend(parsedDate) : false
  if (isSpecialDay) return "SPECIAL_WORK"
  const resolvedWorkMinutes = totalMinutes ?? checkOutMinutes - checkInMinutes
  if (resolvedWorkMinutes > 10 * 60) return "OVERTIME"
  if (checkInMinutes > 9 * 60) return "LATE"
  return null
}

type AttendanceSummary = {
  baseWorkingDays: number
  actualWorkingDays: number
  lateCount: number
  under9hCount: number
  overtimeMinutes: number
  specialWorkDays: number
  annualLeaveDays: number
  halfDayCount: number
  officialLeaveDays: number
  stackedDays: number
}

const formatMinutesToKorean = (minutes: number) => {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60

  if (hour === 0) return `${minute}분`
  if (minute === 0) return `${hour}시간`
  return `${hour}시간 ${minute}분`
}

/** 업로드 시 `warning_message`에 붙는 출·퇴근 원본 접미사 */
const WARNING_RAW_SUFFIX_RE = /\(출근 원본:\s*([^,]*),\s*퇴근 원본:\s*([^)]*)\)\s*$/

function extractRawTimesFromWarningMessage(message: string): { checkIn: string; checkOut: string } {
  const m = message.match(WARNING_RAW_SUFFIX_RE)
  if (!m) return { checkIn: "-", checkOut: "-" }
  return { checkIn: (m[1] ?? "").trim() || "-", checkOut: (m[2] ?? "").trim() || "-" }
}

function formatRawTimeCellForTable(raw: string): string {
  if (!raw || raw === "-") return "-"
  const t = raw.trim()
  if (/^\d{4}$/.test(t)) {
    const hour = Number(t.slice(0, 2))
    const minute = Number(t.slice(2, 4))
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${t.slice(0, 2)}:${t.slice(2, 4)}`
    }
  }
  if (/^\d{3}$/.test(t)) {
    const padded = `0${t}`
    const hour = Number(padded.slice(0, 2))
    const minute = Number(padded.slice(2, 4))
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`
    }
  }
  const colon = t.match(/^(\d{1,2}):(\d{2})$/)
  if (colon) {
    const hour = Number(colon[1])
    const minute = Number(colon[2])
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    }
  }
  return t
}

function warningRowBestRawForDate(warnings: WarningItem[], workDate: string): { checkIn: string; checkOut: string } {
  const forDate = warnings.filter((w) => w.workDate === workDate)
  for (const w of forDate) {
    const r = extractRawTimesFromWarningMessage(w.message)
    if (r.checkIn !== "-" || r.checkOut !== "-") return r
  }
  if (forDate.length > 0) {
    return extractRawTimesFromWarningMessage(forDate[0].message)
  }
  return { checkIn: "-", checkOut: "-" }
}

function dedupeWarningsFromRows(warningsRows: Record<string, unknown>[] | null): WarningItem[] {
  const warningDedup = new Map<string, WarningItem>()
  for (const row of warningsRows ?? []) {
    const workDate = String(row.work_date ?? "-")
    const warningType = String(row.warning_type ?? row.type ?? "-")
    const message = String(row.warning_message ?? row.message ?? "-")
    const key = `${workDate}|${warningType}|${message}`
    if (!warningDedup.has(key)) {
      warningDedup.set(key, { workDate, warningType, message })
    }
  }
  return Array.from(warningDedup.values())
}

/** 8시간 59분(539분) 이하 → 규칙상 이상 (9시간 미만) */
const MAX_NORMAL_WORK_MINUTES = 539

function dedupeWarningItems(items: WarningItem[]): WarningItem[] {
  const m = new Map<string, WarningItem>()
  for (const w of items) {
    const key = `${w.workDate}|${w.warningType}|${w.message}`
    if (!m.has(key)) m.set(key, w)
  }
  return Array.from(m.values()).sort((a, b) => a.workDate.localeCompare(b.workDate))
}

/**
 * 총 근무 분: 출·퇴근 시각 차이 우선, 동일 시각이면 0, 파싱 불가 시 DB total_minutes.
 */
function effectiveWorkMinutesFromAttendanceRow(row: AttendanceRecordRow): {
  effectiveMinutes: number | null
  sameClock: boolean
} {
  const inRaw = String(row.check_in ?? "").trim()
  const outRaw = String(row.check_out ?? "").trim()
  const missingClock = !inRaw || inRaw === "-" || !outRaw || outRaw === "-"

  if (missingClock) {
    const db = row.total_minutes
    return {
      effectiveMinutes: db != null && Number.isFinite(Number(db)) ? Math.max(0, Number(db)) : null,
      sameClock: false,
    }
  }

  const inM = parseTimeToMinutes(inRaw)
  const outM = parseTimeToMinutes(outRaw)
  if (inM !== null && outM !== null) {
    if (inM === outM) {
      return { effectiveMinutes: 0, sameClock: true }
    }
    if (outM > inM) {
      return { effectiveMinutes: outM - inM, sameClock: false }
    }
  }

  const db = row.total_minutes
  return {
    effectiveMinutes: db != null && Number.isFinite(Number(db)) ? Math.max(0, Number(db)) : null,
    sameClock: false,
  }
}

function buildDerivedWarnings(rows: AttendanceRecordRow[], dbWarnings: WarningItem[]): WarningItem[] {
  const typesByDate = new Map<string, Set<string>>()
  const messagesByDate = new Map<string, string[]>()
  for (const w of dbWarnings) {
    if (!typesByDate.has(w.workDate)) typesByDate.set(w.workDate, new Set())
    typesByDate.get(w.workDate)!.add(w.warningType)
    if (!messagesByDate.has(w.workDate)) messagesByDate.set(w.workDate, [])
    messagesByDate.get(w.workDate)!.push(w.message)
  }

  const derived: WarningItem[] = []

  for (const row of rows) {
    const wd = row.work_date
    const types = typesByDate.get(wd) ?? new Set()
    const msgs = messagesByDate.get(wd) ?? []

    const inDisp = String(row.check_in ?? "-").trim()
    const outDisp = String(row.check_out ?? "-").trim()
    const { effectiveMinutes, sameClock } = effectiveWorkMinutesFromAttendanceRow(row)

    const hasInvalidTimeRangeInDb =
      types.has("INVALID_TIME_RANGE") || msgs.some((m) => m.includes("퇴근 시간이 출근"))

    if (sameClock && !hasInvalidTimeRangeInDb && !types.has("SAME_CHECK_IN_OUT")) {
      derived.push({
        workDate: wd,
        warningType: "SAME_CHECK_IN_OUT",
        message: `출근·퇴근 시각이 동일합니다 (${inDisp} / ${outDisp}).`,
      })
    }

    const shortByRule = effectiveMinutes !== null && effectiveMinutes <= MAX_NORMAL_WORK_MINUTES
    const skipUnder9Derived =
      types.has("UNDER_9_HOURS") ||
      types.has("SHORT_WORK_TIME") ||
      sameClock ||
      types.has("INCOMPLETE_TIME")

    if (shortByRule && !skipUnder9Derived) {
      derived.push({
        workDate: wd,
        warningType: "UNDER_9_HOURS",
        message: `1일 근무시간이 9시간 미만입니다 (총 ${formatMinutesToKorean(effectiveMinutes!)}).`,
      })
    }
  }

  return derived
}

function resolveAttendanceStatusBadge(
  sameClock: boolean,
  shortWork: boolean,
  hasDbWarning: boolean,
): AttendanceStatusBadgeLabel {
  if (sameClock) return "이상 있음"
  if (hasDbWarning) return "이상 있음"
  if (shortWork) return "9시간 미만"
  return "정상"
}

function mergeAttendanceRecordsWithWarnings(
  rows: AttendanceRecordRow[],
  allWarnings: WarningItem[],
  dbWarningDates: Set<string>,
): AttendanceRecord[] {
  const byDate = new Map<string, AttendanceRecordRow>()
  for (const row of rows) {
    byDate.set(row.work_date, row)
  }

  const datesWithAnyWarning = new Set(allWarnings.map((w) => w.workDate))
  const allDates = Array.from(new Set<string>([...byDate.keys(), ...datesWithAnyWarning])).sort((a, b) =>
    a.localeCompare(b),
  )

  return allDates.map((workDate) => {
    const row = byDate.get(workDate)
    const hasDbWarning = dbWarningDates.has(workDate)

    if (row) {
      const { effectiveMinutes, sameClock } = effectiveWorkMinutesFromAttendanceRow(row)
      const shortWork = effectiveMinutes !== null && effectiveMinutes <= MAX_NORMAL_WORK_MINUTES
      const statusBadgeLabel = resolveAttendanceStatusBadge(sameClock, shortWork, hasDbWarning)
      const hasDataWarning = statusBadgeLabel !== "정상"

      const totalWorkTime =
        effectiveMinutes !== null ? formatMinutesToKorean(Math.max(0, effectiveMinutes)) : "-"
      const overtimeTime =
        effectiveMinutes !== null
          ? formatMinutesToKorean(Math.max(0, effectiveMinutes - 9 * 60))
          : formatMinutesToKorean(Math.max(0, row.overtime_minutes ?? 0))

      return {
        date: workDate,
        checkIn: row.check_in ?? "-",
        checkOut: row.check_out ?? "-",
        totalWorkTime,
        isLate: Boolean(row.is_late),
        isUnder9h: Boolean(row.is_under_9h) || shortWork || sameClock,
        overtimeTime,
        isSpecialWorkday: Boolean(row.is_special_workday),
        hasDataWarning,
        statusBadgeLabel,
        highOvertimeDay: (row.overtime_minutes ?? 0) >= 59,
      }
    }

    const raw = warningRowBestRawForDate(allWarnings, workDate)
    const checkInDisplay = formatRawTimeCellForTable(raw.checkIn)
    const checkOutDisplay = formatRawTimeCellForTable(raw.checkOut)
    const inM = parseTimeToMinutes(checkInDisplay === "-" ? null : checkInDisplay)
    const outM = parseTimeToMinutes(checkOutDisplay === "-" ? null : checkOutDisplay)
    const workM = inM !== null && outM !== null && outM > inM ? outM - inM : null

    return {
      date: workDate,
      checkIn: checkInDisplay,
      checkOut: checkOutDisplay,
      totalWorkTime: workM !== null ? formatMinutesToKorean(Math.max(0, workM)) : "-",
      isLate: workM !== null && inM !== null ? inM > 9 * 60 : false,
      isUnder9h: workM !== null ? workM < 9 * 60 : false,
      overtimeTime: workM !== null ? formatMinutesToKorean(Math.max(0, workM - 9 * 60)) : "-",
      isSpecialWorkday: false,
      hasDataWarning: true,
      statusBadgeLabel: "이상 있음",
      highOvertimeDay: false,
    }
  })
}

const isWorkdayByDefault = (date: string): boolean => {
  const parsed = parseIsoDate(date)
  if (!parsed) return false
  return !isWeekend(parsed) && !isLegalHoliday(parsed)
}

const countStatus = (rows: AttendanceRecordRow[], keyword: string): number =>
  rows.filter((row) => String(row.work_status ?? "").includes(keyword)).length

const getAttendanceSummary = (rows: AttendanceRecordRow[]): AttendanceSummary => ({
  baseWorkingDays: rows.filter((row) => isWorkdayByDefault(row.work_date)).length,
  actualWorkingDays: rows.filter((row) => Boolean(row.check_in) && Boolean(row.check_out)).length,
  lateCount: rows.filter((row) => Boolean(row.is_late)).length,
  under9hCount: rows.filter((row) => Boolean(row.is_under_9h)).length,
  overtimeMinutes: rows.reduce((sum, row) => sum + Math.max(0, row.overtime_minutes ?? 0), 0),
  specialWorkDays: rows.filter((row) => Boolean(row.is_special_workday)).length,
  annualLeaveDays: countStatus(rows, "연차"),
  halfDayCount: countStatus(rows, "반차"),
  officialLeaveDays: countStatus(rows, "공가"),
  stackedDays: countStatus(rows, "적치"),
})

type PeriodSelection = {
  year: number
  month: number
  day: number
}

const defaultPeriodSelection = (): PeriodSelection => {
  const n = new Date()
  return { year: n.getFullYear(), month: n.getMonth() + 1, day: n.getDate() }
}

export default function EmployeeDashboardPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("month")
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(() => defaultPeriodSelection())
  const [allAttendanceRows, setAllAttendanceRows] = useState<AttendanceRecordRow[]>([])
  const [allDbWarnings, setAllDbWarnings] = useState<WarningItem[]>([])
  const [allMergedWarnings, setAllMergedWarnings] = useState<WarningItem[]>([])
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(true)
  const [attendanceErrorMessage, setAttendanceErrorMessage] = useState<string | null>(null)
  const [isWarningsLoading, setIsWarningsLoading] = useState(true)
  const [isAdminUser, setIsAdminUser] = useState(false)
  const [isGeneratingFinalExcel, setIsGeneratingFinalExcel] = useState(false)

  const loadAttendanceData = useCallback(async () => {
    setIsAttendanceLoading(true)
    setIsWarningsLoading(true)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      console.error("[employee-dashboard] getUser error:", userError)
      setAttendanceErrorMessage("사용자 정보를 확인할 수 없습니다.")
      setAllAttendanceRows([])
      setAllDbWarnings([])
      setAllMergedWarnings([])
      setIsAttendanceLoading(false)
      setIsWarningsLoading(false)
      setPeriodSelection(defaultPeriodSelection())
      return
    }

    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.log("[employee-dashboard] profile role query error:", profileError.message)
      setIsAdminUser(false)
    } else {
      setIsAdminUser(profileRow?.role === "admin")
    }

    setAttendanceErrorMessage(null)

    const [attendanceResult, warningsResult] = await Promise.all([
      supabase
        .from("attendance_records")
        .select(
          "work_date, check_in, check_out, total_minutes, is_late, is_under_9h, overtime_minutes, is_special_workday, work_status",
        )
        .eq("user_id", user.id)
        .order("work_date", { ascending: true }),
      supabase.from("warnings").select("*").eq("user_id", user.id).order("work_date", { ascending: true }),
    ])

    const { data, error } = attendanceResult
    const { data: warningsRows, error: warningsError } = warningsResult

    let attendanceRows: AttendanceRecordRow[] = []
    if (error) {
      console.log("[employee-dashboard] attendance query error:", error.message)
      setAttendanceErrorMessage(error.message ?? "근태 데이터 조회 중 오류가 발생했습니다.")
    } else {
      attendanceRows = (data ?? []) as AttendanceRecordRow[]
      setAttendanceErrorMessage(null)
    }

    let mappedWarningsDb: WarningItem[] = []
    if (warningsError) {
      console.error("[employee-dashboard] warnings query error:", warningsError)
    } else {
      mappedWarningsDb = dedupeWarningsFromRows((warningsRows ?? []) as Record<string, unknown>[])
    }

    const derivedWarnings = buildDerivedWarnings(attendanceRows, mappedWarningsDb)
    const mergedWarnings = dedupeWarningItems([...mappedWarningsDb, ...derivedWarnings])

    setAllAttendanceRows(attendanceRows)
    setAllDbWarnings(mappedWarningsDb)
    setAllMergedWarnings(mergedWarnings)

    const attendanceDateSet = new Set(attendanceRows.map((r) => r.work_date))
    const warningDateSet = new Set(mergedWarnings.map((w) => w.workDate))
    const anchor = resolveDashboardCalendarMonth(new Set<string>([...attendanceDateSet, ...warningDateSet]))
    const now = new Date()
    const dim = new Date(anchor.year, anchor.month, 0).getDate()
    const day =
      anchor.year === now.getFullYear() && anchor.month === now.getMonth() + 1
        ? Math.min(now.getDate(), dim)
        : 1
    setPeriodSelection({ year: anchor.year, month: anchor.month, day })

    setIsAttendanceLoading(false)
    setIsWarningsLoading(false)
  }, [])

  useEffect(() => {
    void loadAttendanceData()
  }, [loadAttendanceData])

  const selectedDateObj = useMemo(
    () => new Date(periodSelection.year, periodSelection.month - 1, periodSelection.day),
    [periodSelection.year, periodSelection.month, periodSelection.day],
  )

  const filterRange = useMemo(() => {
    if (viewMode === "month") return getMonthRangeIso(periodSelection.year, periodSelection.month)
    if (viewMode === "year") return getYearRangeIso(periodSelection.year)
    return getWeekRangeIso(selectedDateObj)
  }, [viewMode, periodSelection.year, periodSelection.month, selectedDateObj])

  const rangeLabel = useMemo(() => {
    if (viewMode === "month") return `${periodSelection.year}년 ${periodSelection.month}월`
    if (viewMode === "year") return `${periodSelection.year}년 (연간)`
    const w = getWeekRangeIso(selectedDateObj)
    return `${w.startIso.replace(/-/g, "/")} – ${w.endIso.replace(/-/g, "/")}`
  }, [viewMode, periodSelection.year, periodSelection.month, selectedDateObj])

  const filteredAttendanceRows = useMemo(
    () => allAttendanceRows.filter((r) => isIsoInRange(r.work_date, filterRange)),
    [allAttendanceRows, filterRange],
  )

  const filteredMergedWarnings = useMemo(
    () => allMergedWarnings.filter((w) => isIsoInRange(w.workDate, filterRange)),
    [allMergedWarnings, filterRange],
  )

  const filteredDbWarnings = useMemo(
    () => allDbWarnings.filter((w) => isIsoInRange(w.workDate, filterRange)),
    [allDbWarnings, filterRange],
  )

  const dbWarningDateSet = useMemo(
    () => new Set(filteredDbWarnings.map((w) => w.workDate)),
    [filteredDbWarnings],
  )

  const attendanceData = useMemo(
    () => mergeAttendanceRecordsWithWarnings(filteredAttendanceRows, filteredMergedWarnings, dbWarningDateSet),
    [filteredAttendanceRows, filteredMergedWarnings, dbWarningDateSet],
  )

  const summary = useMemo(() => getAttendanceSummary(filteredAttendanceRows), [filteredAttendanceRows])

  const calendarMonthRange = useMemo(
    () => getMonthRangeIso(periodSelection.year, periodSelection.month),
    [periodSelection.year, periodSelection.month],
  )

  const calendarAttendanceDates = useMemo(() => {
    const s = new Set<string>()
    for (const r of allAttendanceRows) {
      if (isIsoInRange(r.work_date, calendarMonthRange)) s.add(r.work_date)
    }
    return s
  }, [allAttendanceRows, calendarMonthRange])

  const calendarWarningDates = useMemo(() => {
    const s = new Set<string>()
    for (const w of allMergedWarnings) {
      if (isIsoInRange(w.workDate, calendarMonthRange)) s.add(w.workDate)
    }
    return s
  }, [allMergedWarnings, calendarMonthRange])

  const calendarHighOvertimeDates = useMemo(() => {
    const s = new Set<string>()
    for (const r of allAttendanceRows) {
      if ((r.overtime_minutes ?? 0) >= 59 && isIsoInRange(r.work_date, calendarMonthRange)) {
        s.add(r.work_date)
      }
    }
    return s
  }, [allAttendanceRows, calendarMonthRange])

  const overtimeCardHighlight = summary.overtimeMinutes >= 59

  const navigatePeriod = useCallback(
    (dir: -1 | 1) => {
      setPeriodSelection((p) => {
        if (viewMode === "year") {
          return { ...p, year: p.year + dir }
        }
        let { year, month, day } = p
        month += dir
        if (month > 12) {
          month = 1
          year += 1
        }
        if (month < 1) {
          month = 12
          year -= 1
        }
        const dim = new Date(year, month, 0).getDate()
        return { year, month, day: Math.min(day, dim) }
      })
    },
    [viewMode],
  )

  const handleGenerateFinalExcel = async () => {
    try {
      setIsGeneratingFinalExcel(true)

      const { data: attendanceRows, error: attendanceError } = await supabase
        .from("attendance_records")
        .select("user_id, work_date, check_in, check_out, total_minutes")

      if (attendanceError) {
        console.log("[final-collect-excel] attendance query error:", attendanceError.message)
        return
      }

      const { data: profileRows, error: profileError } = await supabase
        .from("profiles")
        .select("id, name")

      if (profileError) {
        console.log("[final-collect-excel] profile query error:", profileError.message)
        return
      }

      const nameByUserId = new Map<string, string>(
        ((profileRows ?? []) as ProfileNameRow[]).map((profile) => [profile.id, profile.name?.trim() || "미지정 사용자"]),
      )

      const dedupByUserDate = new Map<string, AttendanceExportRow>()
      for (const row of (attendanceRows ?? []) as AttendanceExportRow[]) {
        // 동일 user_id + work_date 중 마지막 레코드를 최신으로 간주
        dedupByUserDate.set(`${row.user_id}|${row.work_date}`, row)
      }
      const dedupedRows = Array.from(dedupByUserDate.values())

      const monthFromDate =
        dedupedRows
          .map((row) => Number(String(row.work_date).slice(5, 7)))
          .find((month) => Number.isFinite(month) && month >= 1 && month <= 12) ?? null
      const resolvedMonth = monthFromDate ?? new Date().getMonth() + 1
      const yearFromDate =
        dedupedRows
          .map((row) => Number(String(row.work_date).slice(0, 4)))
          .find((year) => Number.isFinite(year) && year > 2000) ?? new Date().getFullYear()
      console.log("[final-collect-excel] generate month:", resolvedMonth)

      const templateResponse = await fetch(encodeURI(TEMPLATE_FILE_PATH))
      if (!templateResponse.ok) {
        console.log("[final-collect-excel] template fetch error:", templateResponse.status, TEMPLATE_FILE_PATH)
        return
      }

      const templateBuffer = await templateResponse.arrayBuffer()
      const templateWorkbook = XLSX.read(templateBuffer, { type: "array", cellStyles: true })
      const templateSheetName = templateWorkbook.SheetNames[0]
      if (!templateSheetName) {
        console.log("[final-collect-excel] template sheet not found")
        return
      }
      const templateSheet = templateWorkbook.Sheets[templateSheetName]
      setCellString(templateSheet, TITLE_CELL, `${resolvedMonth}월 3Camp 기술팀 출근부`)

      const mappedRows: Array<AttendanceExportRow & { name: string; day: number }> = []
      for (const row of dedupedRows) {
        const name = (nameByUserId.get(row.user_id) ?? "").trim()
        if (!(name in EMPLOYEE_COLUMN_MAP)) continue
        const year = Number(String(row.work_date).slice(0, 4))
        const month = Number(String(row.work_date).slice(5, 7))
        const day = Number(String(row.work_date).slice(8, 10))
        if (year !== yearFromDate || month !== resolvedMonth || !Number.isFinite(day)) continue
        mappedRows.push({ ...row, name, day })
      }

      const rowsByNameDay = new Map<string, AttendanceExportRow & { name: string; day: number }>()
      for (const row of mappedRows) {
        rowsByNameDay.set(`${row.name}|${row.day}`, row)
      }

      console.log(
        "[final-collect-excel] name-column mapping:",
        Object.entries(EMPLOYEE_COLUMN_MAP).map(([name, col]) => `${name}:${col.checkInCol}-${col.checkOutCol}`).join(", "),
      )

      const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"] as const
      const daysInMonth = new Date(yearFromDate, resolvedMonth, 0).getDate()

      for (let day = 1; day <= 31; day += 1) {
        const rowIndex = TEMPLATE_DATE_START_ROW + day - 1
        const workDate = `${yearFromDate}-${pad2(resolvedMonth)}-${pad2(day)}`
        const dateCell = `${DATE_COLUMN}${rowIndex}`
        const weekdayCell = `${WEEKDAY_COLUMN}${rowIndex}`

        if (day <= daysInMonth) {
          const parsedDate = new Date(`${workDate}T00:00:00`)
          setCellNumber(templateSheet, dateCell, day)
          setCellString(templateSheet, weekdayCell, weekdayNames[parsedDate.getDay()])

          if (isWeekend(parsedDate)) {
            applyRedDateFont(templateSheet, dateCell)
            applyRedDateFont(templateSheet, weekdayCell)
          }
        } else {
          clearCellValue(templateSheet, dateCell)
          clearCellValue(templateSheet, weekdayCell)
        }

        for (const [name, { checkInCol, checkOutCol }] of Object.entries(EMPLOYEE_COLUMN_MAP)) {
          const checkInCell = `${checkInCol}${rowIndex}`
          const checkOutCell = `${checkOutCol}${rowIndex}`
          if (day > daysInMonth) {
            clearCellValue(templateSheet, checkInCell)
            clearCellValue(templateSheet, checkOutCell)
            continue
          }

          const rowData = rowsByNameDay.get(`${name}|${day}`)
          const checkInMinutes = parseTimeToMinutes(rowData?.check_in ?? null)
          const checkOutMinutes = parseTimeToMinutes(rowData?.check_out ?? null)
          setCellString(templateSheet, checkInCell, minutesToHhMm(checkInMinutes))
          setCellString(templateSheet, checkOutCell, minutesToHhMm(checkOutMinutes))

          const statusKind = resolveStatusKind({
            checkInMinutes,
            checkOutMinutes,
            totalMinutes: rowData?.total_minutes ?? null,
            workDate,
          })
          if (statusKind) {
            const color = STATUS_COLOR[statusKind]
            applyPriorityColor(templateSheet, checkInCell, color)
            applyPriorityColor(templateSheet, checkOutCell, color)
          }
        }
      }

      const targetSheetName = toValidSheetName(`${resolvedMonth}월 기술팀`)
      if (templateSheetName !== targetSheetName) {
        templateWorkbook.Sheets[targetSheetName] = templateWorkbook.Sheets[templateSheetName]
        delete templateWorkbook.Sheets[templateSheetName]
        templateWorkbook.SheetNames[0] = targetSheetName
      }

      XLSX.writeFile(templateWorkbook, `${resolvedMonth}월 3Camp 기술팀 출근부.xlsx`)
    } catch (error) {
      console.log("[final-collect-excel] unexpected error:", error)
    } finally {
      setIsGeneratingFinalExcel(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 인사 문구 */}
        <EmployeeDashboardGreeting />

        {/* 통계 카드 + 월별 미니 달력 */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="기본 근무일수"
            value={`${summary.baseWorkingDays}일`}
            icon={Calendar}
            description="평일(월~금) 기준"
            variant="success"
          />
          <StatCard
            title="실제 근무일수"
            value={`${summary.actualWorkingDays}일`}
            icon={BriefcaseBusiness}
            description="주말/공휴일 특근 포함"
            variant="default"
          />
          <StatCard
            title="지각 횟수"
            value={`${summary.lateCount}회`}
            icon={Clock}
            description="정상 출근시간 기준"
            variant="warning"
          />
          <StatCard
            title="9시간 미만 횟수"
            value={`${summary.under9hCount}회`}
            icon={AlertTriangle}
            description="근무시간 부족"
            variant="destructive"
          />
          <StatCard
            title="추가근무 시간"
            value={formatMinutesToKorean(summary.overtimeMinutes)}
            icon={TrendingUp}
            description="9시간 초과 누적"
            variant="default"
            emphasizeBlue={overtimeCardHighlight}
          />
          <StatCard
            title="특근 일수"
            value={`${summary.specialWorkDays}일`}
            icon={CalendarCheck2}
            description="주말/공휴일 근무"
            variant="destructive"
          />
          <StatCard
            title="연차 사용일수"
            value={`${summary.annualLeaveDays}일`}
            icon={BadgeCheck}
            variant="default"
          />
          <StatCard
            title="반차 사용횟수"
            value={`${summary.halfDayCount}회`}
            icon={BadgeCheck}
            variant="default"
          />
          <StatCard
            title="공가 일수"
            value={`${summary.officialLeaveDays}일`}
            icon={ClipboardList}
            variant="default"
          />
          <StatCard
            title="적치 일수"
            value={`${summary.stackedDays}일`}
            icon={ClipboardList}
            variant="default"
          />
          </div>
          <div className="w-full shrink-0 lg:w-72 lg:max-w-[min(100%,20rem)]">
            <AttendanceMiniCalendar
              year={periodSelection.year}
              month={periodSelection.month}
              onNavigatePrev={() => navigatePeriod(-1)}
              onNavigateNext={() => navigatePeriod(1)}
              attendanceDates={calendarAttendanceDates}
              warningDates={calendarWarningDates}
              highOvertimeDates={calendarHighOvertimeDates}
            />
          </div>
        </div>

        {/* 근태 테이블 섹션 */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="flex flex-col gap-3 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <CardTitle className="text-lg shrink-0">근태 현황</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-slate-600"
                  onClick={() => navigatePeriod(-1)}
                  aria-label="이전 기간"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-0 flex-1 truncate text-center text-sm font-medium text-slate-700 tabular-nums sm:text-base">
                  {rangeLabel}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-slate-600"
                  onClick={() => navigatePeriod(1)}
                  aria-label="다음 기간"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Tabs
                value={viewMode}
                onValueChange={(v) => setViewMode(v as ViewMode)}
                className="w-full sm:w-auto"
              >
                <TabsList className="grid h-9 w-full grid-cols-3 bg-slate-100 sm:inline-flex sm:w-auto">
                  <TabsTrigger value="week" className="text-xs sm:text-sm">
                    주별
                  </TabsTrigger>
                  <TabsTrigger value="month" className="text-xs sm:text-sm">
                    월별
                  </TabsTrigger>
                  <TabsTrigger value="year" className="text-xs sm:text-sm">
                    연도별
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {isAdminUser && (
                <Button
                  onClick={() => {
                    console.log("엑셀 생성 클릭")
                    void handleGenerateFinalExcel()
                  }}
                  disabled={isGeneratingFinalExcel}
                  className="rounded-lg bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-600 disabled:opacity-70 sm:px-6 sm:py-3 sm:text-sm"
                >
                  {isGeneratingFinalExcel ? "생성 중..." : "최종 취합 엑셀 생성"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <AttendanceTable
              data={attendanceData}
              isLoading={isAttendanceLoading}
              emptyMessage={attendanceErrorMessage ?? "근태 데이터가 없습니다"}
            />
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">확인 필요 항목</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="rounded-lg border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>날짜</TableHead>
                    <TableHead>유형</TableHead>
                    <TableHead>내용</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isWarningsLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-slate-500">
                        로딩 중...
                      </TableCell>
                    </TableRow>
                  ) : filteredMergedWarnings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-slate-500">
                        확인 필요 항목이 없습니다
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMergedWarnings.map((warning) => (
                      <TableRow key={`${warning.workDate}-${warning.warningType}-${warning.message}`}>
                        <TableCell className={cn("tabular-nums tracking-tight", getDateTextClassName(warning.workDate))}>
                          {warning.workDate}
                        </TableCell>
                        <TableCell>{warning.warningType}</TableCell>
                        <TableCell>{warning.message}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* 엑셀 업로드 */}
        <div className="grid gap-6 lg:grid-cols-2">
          <UploadCard
            onUpload={(file) => {
              console.log("Uploaded file:", file.name)
              void loadAttendanceData()
            }}
          />
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">업로드 가이드</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary font-medium">1.</span>
                  근태 데이터가 포함된 엑셀 파일을 준비하세요.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-medium">2.</span>
                  파일 형식은 .xlsx 또는 .xls만 지원됩니다.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-medium">3.</span>
                  업로드 후 자동으로 데이터가 처리됩니다.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-medium">4.</span>
                  문제가 있으면 관리자에게 문의하세요.
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
