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
import ExcelJS from "exceljs"
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
  Users,
  CheckCircle,
  XCircle,
  LayoutDashboard,
} from "lucide-react"

function EmployeeDashboardGreeting({ isAdminUser }: { isAdminUser: boolean }) {
  const displayName = useDashboardUserName()
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">
        {isAdminUser ? "근태 관리 센터" : `${displayName}님 행복하세요 😊`}
      </h1>
      <p className="text-muted-foreground mt-1">
        {isAdminUser
          ? "직원별 근태 업로드 및 이상 항목을 한눈에 확인하세요."
          : "오늘도 좋은 하루 되세요."}
      </p>
    </div>
  )
}

type AttendanceRecordRow = {
  user_id?: string | null
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
  userId?: string
  employeeName?: string
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
  year?: number | null
  month?: number | null
  work_status?: string | null
}

type ProfileNameRow = {
  id: string
  name: string | null
  role?: string | null
  email?: string | null
}

const ADMIN_EMPLOYEE_ORDER = [
  "장영광",
  "심종하",
  "오민석",
  "권태준",
  "김정훈",
  "이민성",
  "김희수",
  "김선태",
  "윤효준",
] as const
const ALL_EMPLOYEES_LABEL = "전체 직원"
const ADMIN_EMPLOYEE_FILTER_OPTIONS = [ALL_EMPLOYEES_LABEL, ...ADMIN_EMPLOYEE_ORDER] as const
const ADMIN_DEFAULT_YEAR = 2026
const ADMIN_DEFAULT_MONTH = 4

/** 관리자 직원명 비교용(공백·유니코드 정규화) */
function normalizeAdminEmployeeDisplayName(name: string): string {
  return name.trim().normalize("NFC")
}

function isProfilesEmployeeRole(role: string | null | undefined): boolean {
  return String(role ?? "").toLowerCase() === "employee"
}

/**
 * 최종 취합 엑셀 전용. 반드시 `public/templates/template.xlsx` → `/templates/template.xlsx` 만 사용합니다.
 * (다른 파일명·templates.xls·캐시된 구버전 경로 사용 금지 — fetch 시 `?t=` 로 캐시 무력화)
 */
const TEMPLATE_URL_PATH = "/templates/template.xlsx"
const TEMPLATE_SHEET_PREFERRED_NAME = "3월 기술팀"
const TITLE_CELL = "A1"
const TEMPLATE_DATE_START_ROW = 4
const TEMPLATE_DATE_END_ROW = 34
const DATE_COLUMN = "A"
const WEEKDAY_COLUMN = "B"

/** C4:T34(열 3~20, 행 4~34) 출퇴근 데이터 영역과 병합이 겹치는지 */
function mergeRangeIntersectsC4T34(dim: { top: number; left: number; bottom: number; right: number }): boolean {
  const r0 = Math.max(dim.top, TEMPLATE_DATE_START_ROW)
  const r1 = Math.min(dim.bottom, TEMPLATE_DATE_END_ROW)
  const c0 = Math.max(dim.left, 3)
  const c1 = Math.min(dim.right, 20)
  return r0 <= r1 && c0 <= c1
}

const EMPLOYEE_COLUMN_MAP: Record<string, { checkInCol: string; checkOutCol: string }> = {
  장영광: { checkInCol: "C", checkOutCol: "D" },
  심종하: { checkInCol: "E", checkOutCol: "F" },
  오민석: { checkInCol: "G", checkOutCol: "H" },
  권태준: { checkInCol: "I", checkOutCol: "J" },
  김정훈: { checkInCol: "K", checkOutCol: "L" },
  이민성: { checkInCol: "M", checkOutCol: "N" },
  김희수: { checkInCol: "O", checkOutCol: "P" },
  김선태: { checkInCol: "Q", checkOutCol: "R" },
  윤효준: { checkInCol: "S", checkOutCol: "T" },
}

/** 최종 취합 엑셀 범례·상태 칠하기 전용 (ARGB 8자리만 사용) */
const STATUS_COLOR_MAP: Record<string, string> = {
  결근: "FFFF0000",
  연차: "FFF79646",
  특근: "FFA9D18E",
  조퇴: "FF00B050",
  추가근무: "FF92CDDC",
  보건: "FF8EA9DB",
  휴무: "FFB4A7C0",
  지각: "FFFF99CC",
  반차: "FFE26B0A",
  공가: "FFC4BD97",
  적치: "FFFFFF00",
  국내출장: "FF4F81BD",
  예비군훈련: "FF948A54",
  이상: "FFF4CCCC",
}

const WHITE_FILL_ARGB = "FFFFFFFF"
const LEGEND_BORDER_ARGB = "FF000000"

/** 최종 취합 엑셀 W열 범례 전용 (X열·병합 사용 금지) */
const FINAL_EXCEL_LEGEND_ROWS: ReadonlyArray<{ row: number; label: string }> = [
  { row: 5, label: "결근" },
  { row: 7, label: "연차" },
  { row: 9, label: "특근" },
  { row: 11, label: "조퇴" },
  { row: 13, label: "추가근무" },
  { row: 15, label: "보건" },
  { row: 17, label: "휴무" },
  { row: 19, label: "지각" },
  { row: 21, label: "반차" },
  { row: 23, label: "공가" },
  { row: 25, label: "연차" },
  { row: 27, label: "적치" },
  { row: 29, label: "국내출장" },
  { row: 31, label: "예비군훈련" },
]

const WORK_STATUS_ANOMALY_MARKERS = ["INVALID_CHECK_IN_TIME", "INCOMPLETE_TIME", "INVALID_TIME_RANGE"] as const

/** 출퇴근 시각 → 분 (08:09 / 0809 / 8:09 등) */
function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw || raw === "-") return null
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":").map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return null
    if (h < 0 || h > 23 || m < 0 || m > 59) return null
    return h * 60 + m
  }
  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, "0")
    const h = Number(padded.slice(0, 2))
    const m = Number(padded.slice(2, 4))
    if (Number.isNaN(h) || Number.isNaN(m)) return null
    if (h < 0 || h > 23 || m < 0 || m > 59) return null
    return h * 60 + m
  }
  return null
}

const parseTimeToMinutes = (time: string | null): number | null => timeToMinutes(time)

const minutesToHhMm = (minutes: number | null): string => {
  if (minutes === null) return ""
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

/** DB 값 → 엑셀 표시용 HH:mm (null/빈값/`-` 는 빈 문자열) */
const formatCheckInOutForCell = (value: string | null | undefined): string => {
  if (value == null) return ""
  const t = String(value).trim()
  if (!t || t === "-") return ""
  const m = parseTimeToMinutes(t)
  if (m === null) return t
  return minutesToHhMm(m)
}

const pad2 = (value: number) => String(value).padStart(2, "0")

const getMappedEmployeeColumns = (name: string): { checkInCol: string; checkOutCol: string } | null => {
  if (!Object.prototype.hasOwnProperty.call(EMPLOYEE_COLUMN_MAP, name)) return null
  return EMPLOYEE_COLUMN_MAP[name as keyof typeof EMPLOYEE_COLUMN_MAP]
}

const isAdminProfile = (p: ProfileNameRow): boolean => p.role === "admin" || (p.name ?? "").trim() === "관리자"

const isSpecialWorkDate = (workDate: string): boolean => {
  const parsed = parseIsoDate(workDate)
  if (!parsed) return false
  return isWeekend(parsed) || isLegalHoliday(parsed)
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

type AdminSummary = {
  totalEmployees: number
  uploadedEmployees: number
  notUploadedEmployees: number
  employeesWithWarning: number
  totalLateCount: number
  totalUnder9hCount: number
  totalOvertimeMinutes: number
  specialWorkDays: number
}

type AdminTopAnomalyEntry = { name: string; count: number }
type AdminPriorityCheckItem = { employeeName: string; workDate: string; kindLabel: string }
type AdminWarningPanelRow = {
  userId: string
  employeeName: string
  workDate: string
  warningType: string
  checkInOriginal: string
  checkOutOriginal: string
  compactMessage: string
  message: string
}

const ADMIN_EMPLOYEE_NAME_SET = new Set<string>(ADMIN_EMPLOYEE_ORDER)

/** 관리자 요약: 행 단위 이상(지각·9시간 미만·동일 시각 등) 여부 및 우선순위 라벨 */
function classifyAdminRowPriorityKind(row: AttendanceRecordRow): { hasIssue: boolean; kindLabel: string } {
  const { effectiveMinutes, sameClock } = effectiveWorkMinutesFromAttendanceRow(row)
  const shortWork = effectiveMinutes !== null && effectiveMinutes <= MAX_NORMAL_WORK_MINUTES
  const under9Rule = Boolean(row.is_under_9h) || sameClock || shortWork

  if (sameClock) return { hasIssue: true, kindLabel: "출퇴근 시각 동일" }
  if (row.is_late) return { hasIssue: true, kindLabel: "지각" }
  if (under9Rule) return { hasIssue: true, kindLabel: "9시간 미만" }
  return { hasIssue: false, kindLabel: "" }
}

function adminRowHasAnyAnomaly(row: AttendanceRecordRow): boolean {
  return classifyAdminRowPriorityKind(row).hasIssue
}

function mapAdminAttendanceRows(
  rows: AttendanceRecordRow[],
  nameByUserId: Map<string, string>,
  warnings: WarningItem[],
): AttendanceRecord[] {
  const employeeOrderMap = new Map<string, number>(ADMIN_EMPLOYEE_ORDER.map((name, index) => [name, index]))
  const fallbackOrderBase = ADMIN_EMPLOYEE_ORDER.length
  const warningByEmployeeDate = new Map<string, WarningItem[]>()
  for (const w of warnings) {
    const uid = String(w.userId ?? "")
    if (!uid) continue
    const key = `${uid}|${w.workDate}`
    const prev = warningByEmployeeDate.get(key) ?? []
    prev.push(w)
    warningByEmployeeDate.set(key, prev)
  }
  const mappedByKey = new Map<string, AttendanceRecord>()

  const mapped = rows.map((row) => {
    const uid = String(row.user_id ?? "")
    const employeeName = uid ? nameByUserId.get(uid) ?? "" : ""
    const rowWarnings = warningByEmployeeDate.get(`${uid}|${row.work_date}`) ?? []
    const { effectiveMinutes, sameClock } = effectiveWorkMinutesFromAttendanceRow(row)
    const shortWork = effectiveMinutes !== null && effectiveMinutes <= MAX_NORMAL_WORK_MINUTES
    const hasDataWarning = Boolean(row.is_late) || shortWork || sameClock || rowWarnings.length > 0
    const statusBadgeLabel: AttendanceStatusBadgeLabel = hasDataWarning
      ? sameClock || Boolean(row.is_late)
        ? "이상 있음"
        : "9시간 미만"
      : "정상"

    const checkInRaw = row.check_in == null || String(row.check_in).trim() === "" ? "-" : String(row.check_in).trim()
    const checkOutRaw =
      row.check_out == null || String(row.check_out).trim() === "" ? "-" : String(row.check_out).trim()
    const warningRaw = warningRowBestRawForDate(rowWarnings, row.work_date)
    const warningType = rowWarnings.length > 0 ? rowWarnings.map((w) => w.warningType).join(", ") : "-"
    const warningMessage = rowWarnings.length > 0 ? rowWarnings.map((w) => w.message).join(" | ") : "-"

    const mappedRow: AttendanceRecord = {
      employeeName,
      date: row.work_date,
      checkIn: checkInRaw !== "-" ? formatRawTimeCellForTable(checkInRaw) : formatRawTimeCellForTable(warningRaw.checkIn),
      checkOut: checkOutRaw !== "-" ? formatRawTimeCellForTable(checkOutRaw) : formatRawTimeCellForTable(warningRaw.checkOut),
      totalWorkTime:
        effectiveMinutes !== null ? formatMinutesToKorean(Math.max(0, effectiveMinutes)) : "-",
      isLate: Boolean(row.is_late),
      isUnder9h: Boolean(row.is_under_9h) || shortWork || sameClock,
      overtimeTime: formatMinutesToKorean(Math.max(0, effectiveMinutes !== null ? effectiveMinutes - 9 * 60 : 0)),
      isSpecialWorkday: Boolean(row.is_special_workday),
      hasDataWarning,
      statusBadgeLabel,
      highOvertimeDay: (row.overtime_minutes ?? 0) >= 59,
      warningType,
      warningMessage,
    }
    mappedByKey.set(`${uid}|${row.work_date}`, mappedRow)
    return mappedRow
  })

  for (const [key, warningRows] of warningByEmployeeDate.entries()) {
    if (mappedByKey.has(key)) continue
    const [uid, workDate] = key.split("|")
    const employeeName = nameByUserId.get(uid) ?? warningRows[0]?.employeeName ?? ""
    const warningRaw = warningRowBestRawForDate(warningRows, workDate)
    mapped.push({
      employeeName,
      date: workDate,
      checkIn: formatRawTimeCellForTable(warningRaw.checkIn),
      checkOut: formatRawTimeCellForTable(warningRaw.checkOut),
      totalWorkTime: "-",
      isLate: false,
      isUnder9h: false,
      overtimeTime: "-",
      isSpecialWorkday: false,
      hasDataWarning: true,
      statusBadgeLabel: "이상 있음",
      highOvertimeDay: false,
      warningType: warningRows.map((w) => w.warningType).join(", "),
      warningMessage: warningRows.map((w) => w.message).join(" | "),
    })
  }

  return mapped.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date)
    if (byDate !== 0) return byDate
    const aOrder = employeeOrderMap.get(a.employeeName ?? "") ?? fallbackOrderBase
    const bOrder = employeeOrderMap.get(b.employeeName ?? "") ?? fallbackOrderBase
    if (aOrder !== bOrder) return aOrder - bOrder
    return (a.employeeName ?? "").localeCompare(b.employeeName ?? "", "ko")
  })
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
    const userId = String(row.user_id ?? "")
    const workDate = String(row.work_date ?? "-")
    const warningType = String(row.warning_type ?? row.type ?? "-")
    const message = String(row.warning_message ?? row.message ?? "-")
    const key = `${userId}|${workDate}|${warningType}|${message}`
    if (!warningDedup.has(key)) {
      warningDedup.set(key, { userId, workDate, warningType, message })
    }
  }
  return Array.from(warningDedup.values())
}

/** 8시간 59분(539분) 이하 → 규칙상 이상 (9시간 미만) */
const MAX_NORMAL_WORK_MINUTES = 539

function dedupeWarningItems(items: WarningItem[]): WarningItem[] {
  const m = new Map<string, WarningItem>()
  for (const w of items) {
    const key = `${w.userId ?? ""}|${w.workDate}|${w.warningType}|${w.message}`
    if (!m.has(key)) m.set(key, w)
  }
  return Array.from(m.values()).sort((a, b) => a.workDate.localeCompare(b.workDate))
}

function getWarningTypeOrder(warningType: string): number {
  if (warningType === "INCOMPLETE_TIME") return 0
  if (warningType === "INVALID_CHECK_IN_TIME") return 1
  if (warningType === "INVALID_TIME_RANGE") return 2
  return 3
}

function toCompactWarningMessage(warningType: string, message: string): string {
  const m = message.trim()
  if (warningType === "INCOMPLETE_TIME") return "출근 또는 퇴근 누락"
  if (warningType === "INVALID_CHECK_IN_TIME") return "출근 시간 범위 오류"
  if (warningType === "INVALID_TIME_RANGE") return "퇴근 시간이 출근보다 빠름"
  if (m.includes("출근") && m.includes("퇴근") && m.includes("누락")) return "출근 또는 퇴근 누락"
  if (m.includes("출근 시간") && m.includes("범위")) return "출근 시간 범위 오류"
  if (m.includes("퇴근 시간이 출근")) return "퇴근 시간이 출근보다 빠름"
  return m.length > 50 ? `${m.slice(0, 50)}...` : m
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
  const [selectedYear, setSelectedYear] = useState<number>(ADMIN_DEFAULT_YEAR)
  const [selectedMonth, setSelectedMonth] = useState<number>(ADMIN_DEFAULT_MONTH)
  const [tempSelectedEmployeeName, setTempSelectedEmployeeName] = useState<string>(ALL_EMPLOYEES_LABEL)
  const [selectedEmployeeName, setSelectedEmployeeName] = useState<string>(ALL_EMPLOYEES_LABEL)
  const [allAttendanceRows, setAllAttendanceRows] = useState<AttendanceRecordRow[]>([])
  const [allDbWarnings, setAllDbWarnings] = useState<WarningItem[]>([])
  const [allMergedWarnings, setAllMergedWarnings] = useState<WarningItem[]>([])
  const [adminEmployeeNameByUserId, setAdminEmployeeNameByUserId] = useState<Map<string, string>>(new Map())
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(true)
  const [attendanceErrorMessage, setAttendanceErrorMessage] = useState<string | null>(null)
  const [finalExcelMessage, setFinalExcelMessage] = useState<string | null>(null)
  const [isWarningsLoading, setIsWarningsLoading] = useState(true)
  const [isAdminUser, setIsAdminUser] = useState(false)
  const [isGeneratingFinalExcel, setIsGeneratingFinalExcel] = useState(false)
  const isLoggingOut =
    typeof window !== "undefined" && window.sessionStorage.getItem("ctst:isLoggingOut") === "1"

  const loadAttendanceData = useCallback(async () => {
    if (isLoggingOut) return
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
    console.log("[admin attendance] currentUserRole:", profileRow?.role ?? "unknown")

    const isAdmin = profileRow?.role === "admin"
    if (isAdmin) {
      const monthStr = String(selectedMonth).padStart(2, "0")
      const startDate = `${selectedYear}-${monthStr}-01`
      const nextMonthStart =
        selectedMonth === 12
          ? `${selectedYear + 1}-01-01`
          : `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-01`

      type AdminAttendanceQueryRow = {
        user_id: string
        work_date: string
        check_in: string | null
        check_out: string | null
        total_minutes?: number | null
        is_late?: boolean | null
        is_under_9h?: boolean | null
        overtime_minutes?: number | null
        is_special_workday?: boolean | null
        work_status?: string | null
        year?: number | null
        month?: number | null
      }

      type SimpleProfile = { id: string; name: string | null; role: string | null }

      const ymResult = await supabase
        .from("attendance_records")
        .select("*")
        .eq("year", selectedYear)
        .eq("month", selectedMonth)

      let records: AdminAttendanceQueryRow[] = []

      const loadByWorkDateRange = async (): Promise<AdminAttendanceQueryRow[]> => {
        const wdResult = await supabase
          .from("attendance_records")
          .select("*")
          .gte("work_date", startDate)
          .lt("work_date", nextMonthStart)
        if (wdResult.error) {
          throw new Error(wdResult.error.message ?? "근태 데이터 조회 중 오류가 발생했습니다.")
        }
        return (wdResult.data ?? []) as AdminAttendanceQueryRow[]
      }

      if (ymResult.error) {
        console.warn("[admin attendance] year/month query failed, using work_date range:", ymResult.error.message)
        try {
          records = await loadByWorkDateRange()
        } catch (e) {
          const msg = e instanceof Error ? e.message : "근태 데이터 조회 중 오류가 발생했습니다."
          console.error("[admin attendance] work_date range query error:", msg)
          setAttendanceErrorMessage(msg)
          setAllAttendanceRows([])
          setAllDbWarnings([])
          setAllMergedWarnings([])
          setIsAttendanceLoading(false)
          setIsWarningsLoading(false)
          return
        }
      } else {
        records = (ymResult.data ?? []) as AdminAttendanceQueryRow[]
        if (records.length === 0) {
          try {
            records = await loadByWorkDateRange()
          } catch (e) {
            const msg = e instanceof Error ? e.message : "근태 데이터 조회 중 오류가 발생했습니다."
            console.error("[admin attendance] fallback work_date query error:", msg)
            setAttendanceErrorMessage(msg)
            setAllAttendanceRows([])
            setAllDbWarnings([])
            setAllMergedWarnings([])
            setIsAttendanceLoading(false)
            setIsWarningsLoading(false)
            return
          }
        }
      }

      const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id, name, role")

      if (profilesError) {
        console.error("[admin attendance] profiles query error:", profilesError.message)
        setAttendanceErrorMessage(profilesError.message ?? "프로필 조회 중 오류가 발생했습니다.")
        setAllAttendanceRows([])
        setAllDbWarnings([])
        setAllMergedWarnings([])
        setIsAttendanceLoading(false)
        setIsWarningsLoading(false)
        return
      }

      const safeRecords = records ?? []
      const safeProfiles = (profiles ?? []) as SimpleProfile[]
      const warningsResult = await supabase
        .from("warnings")
        .select("*")
        .eq("year", selectedYear)
        .eq("month", selectedMonth)

      let warningRows = (warningsResult.data ?? []) as Record<string, unknown>[]
      if (warningsResult.error || warningRows.length === 0) {
        const fallbackWarningsResult = await supabase
          .from("warnings")
          .select("*")
          .gte("work_date", startDate)
          .lt("work_date", nextMonthStart)
        if (fallbackWarningsResult.error) {
          console.error("[admin attendance] warnings query error:", fallbackWarningsResult.error.message)
        } else {
          warningRows = (fallbackWarningsResult.data ?? []) as Record<string, unknown>[]
        }
      }
      const safeWarnings = warningRows ?? []

      type MappedAdminRecord = AdminAttendanceQueryRow & {
        employeeName: string
        employeeRole: string
      }

      const mappedRecords: MappedAdminRecord[] = safeRecords
        .map((record) => {
          const uid = String(record.user_id ?? "")
          const profile = safeProfiles.find((p) => String(p.id) === uid)
          return {
            ...record,
            user_id: uid,
            employeeName: normalizeAdminEmployeeDisplayName(profile?.name ?? ""),
            employeeRole: String(profile?.role ?? ""),
          }
        })
        .filter(
          (record) =>
            isProfilesEmployeeRole(record.employeeRole) &&
            record.employeeName !== "" &&
            normalizeAdminEmployeeDisplayName(record.employeeName) !== "관리자",
        )

      type MappedAdminWarning = WarningItem & { employeeRole: string }
      const mappedWarnings: MappedAdminWarning[] = dedupeWarningsFromRows(safeWarnings)
        .map((w) => {
          const profile = safeProfiles.find((p) => String(p.id) === String(w.userId ?? ""))
          return {
            ...w,
            employeeName: normalizeAdminEmployeeDisplayName(profile?.name ?? ""),
            employeeRole: String(profile?.role ?? ""),
          }
        })
        .filter(
          (w) =>
            isProfilesEmployeeRole(w.employeeRole) &&
            normalizeAdminEmployeeDisplayName(w.employeeName ?? "") !== "관리자",
        )

      const employeeNameMap = new Map<string, string>()
      for (const p of safeProfiles) {
        if (isProfilesEmployeeRole(p.role) && normalizeAdminEmployeeDisplayName(p.name ?? "") !== "관리자") {
          employeeNameMap.set(String(p.id), normalizeAdminEmployeeDisplayName(p.name ?? ""))
        }
      }
      setAdminEmployeeNameByUserId(employeeNameMap)

      console.log("[admin attendance] selected:", selectedYear, selectedMonth)
      console.log("[admin attendance] attendance records:", safeRecords.length)
      console.log("[admin attendance] warnings:", safeWarnings.length)
      console.log("[admin attendance] profiles:", safeProfiles.length)
      console.log("[admin attendance] mapped attendance:", mappedRecords.length)
      console.log("[admin attendance] mapped warnings:", mappedWarnings.length)

      const mappedEmployeeRows: AttendanceRecordRow[] = mappedRecords.map((r) => ({
        user_id: r.user_id,
        work_date: r.work_date,
        check_in: r.check_in,
        check_out: r.check_out,
        total_minutes: r.total_minutes ?? null,
        is_late: r.is_late ?? null,
        is_under_9h: r.is_under_9h ?? null,
        overtime_minutes: r.overtime_minutes ?? null,
        is_special_workday: r.is_special_workday ?? null,
        work_status: r.work_status ?? null,
      }))

      setAttendanceErrorMessage(mappedEmployeeRows.length + mappedWarnings.length > 0 ? null : "근태 데이터가 없습니다")
      setAllAttendanceRows(mappedEmployeeRows)
      setAllDbWarnings(mappedWarnings)
      setAllMergedWarnings(mappedWarnings)
      setPeriodSelection((prev) => {
        const dim = new Date(selectedYear, selectedMonth, 0).getDate()
        return { year: selectedYear, month: selectedMonth, day: Math.min(prev.day, dim) }
      })
      setIsAttendanceLoading(false)
      setIsWarningsLoading(false)
      return
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
      setAttendanceErrorMessage(attendanceRows.length > 0 ? null : "근태 데이터가 없습니다")
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
    setAdminEmployeeNameByUserId(new Map())

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
  }, [selectedYear, selectedMonth, isLoggingOut])

  useEffect(() => {
    void loadAttendanceData()
  }, [loadAttendanceData])

  const selectedDateObj = useMemo(
    () => new Date(periodSelection.year, periodSelection.month - 1, periodSelection.day),
    [periodSelection.year, periodSelection.month, periodSelection.day],
  )

  const filterRange = useMemo(() => {
    if (isAdminUser) {
      return getMonthRangeIso(selectedYear, selectedMonth)
    }
    if (viewMode === "month") return getMonthRangeIso(periodSelection.year, periodSelection.month)
    if (viewMode === "year") return getYearRangeIso(periodSelection.year)
    return getWeekRangeIso(selectedDateObj)
  }, [isAdminUser, selectedYear, selectedMonth, viewMode, periodSelection.year, periodSelection.month, selectedDateObj])

  const rangeLabel = useMemo(() => {
    if (viewMode === "month") return `${periodSelection.year}년 ${periodSelection.month}월`
    if (viewMode === "year") return `${periodSelection.year}년 (연간)`
    const w = getWeekRangeIso(selectedDateObj)
    return `${w.startIso.replace(/-/g, "/")} – ${w.endIso.replace(/-/g, "/")}`
  }, [viewMode, periodSelection.year, periodSelection.month, selectedDateObj])

  const filteredAttendanceRows = useMemo(() => {
    const inRangeRows = allAttendanceRows.filter((r) => isIsoInRange(r.work_date, filterRange))
    if (!isAdminUser) {
      return inRangeRows
    }
    const selection = normalizeAdminEmployeeDisplayName(selectedEmployeeName)
    if (selection === ALL_EMPLOYEES_LABEL) {
      return inRangeRows
    }
    return inRangeRows.filter((row) => {
      const uid = String(row.user_id ?? "")
      const employeeName = uid ? (adminEmployeeNameByUserId.get(uid) ?? "") : ""
      return normalizeAdminEmployeeDisplayName(employeeName) === selection
    })
  }, [allAttendanceRows, filterRange, isAdminUser, selectedEmployeeName, adminEmployeeNameByUserId])

  const filteredMergedWarnings = useMemo(
    () => allMergedWarnings.filter((w) => isIsoInRange(w.workDate, filterRange)),
    [allMergedWarnings, filterRange],
  )

  const adminFilteredWarnings = useMemo(() => {
    if (!isAdminUser) return [] as WarningItem[]
    const selection = normalizeAdminEmployeeDisplayName(selectedEmployeeName)
    const inRange = allMergedWarnings.filter((w) => isIsoInRange(w.workDate, filterRange))
    if (selection === ALL_EMPLOYEES_LABEL) return inRange
    return inRange.filter((w) => normalizeAdminEmployeeDisplayName(w.employeeName ?? "") === selection)
  }, [isAdminUser, allMergedWarnings, filterRange, selectedEmployeeName])

  const filteredDbWarnings = useMemo(
    () => allDbWarnings.filter((w) => isIsoInRange(w.workDate, filterRange)),
    [allDbWarnings, filterRange],
  )

  const warningPanelRows = useMemo(() => {
    if (!isAdminUser) {
      return filteredMergedWarnings.map((w) => {
        const raw = extractRawTimesFromWarningMessage(w.message)
        return {
          userId: String(w.userId ?? ""),
          employeeName: normalizeAdminEmployeeDisplayName(w.employeeName ?? ""),
          workDate: w.workDate,
          warningType: w.warningType,
          checkInOriginal: formatRawTimeCellForTable(raw.checkIn),
          checkOutOriginal: formatRawTimeCellForTable(raw.checkOut),
          compactMessage: toCompactWarningMessage(w.warningType, w.message),
          message: w.message,
        } as AdminWarningPanelRow
      })
    }

    const safeWarnings = filteredMergedWarnings
    const mappedWarnings = safeWarnings.filter((w) => {
      const employeeName = normalizeAdminEmployeeDisplayName(w.employeeName ?? "")
      if (!employeeName || employeeName === "관리자") return false
      const uid = String(w.userId ?? "")
      if (!uid) return false
      if (normalizeAdminEmployeeDisplayName(selectedEmployeeName) === ALL_EMPLOYEES_LABEL) return true
      return employeeName === normalizeAdminEmployeeDisplayName(selectedEmployeeName)
    })

    const dedupMap = new Map<string, AdminWarningPanelRow>()
    for (const w of mappedWarnings) {
      const raw = extractRawTimesFromWarningMessage(w.message)
      const checkInOriginal = formatRawTimeCellForTable(raw.checkIn)
      const checkOutOriginal = formatRawTimeCellForTable(raw.checkOut)
      const uid = String(w.userId ?? "")
      const employeeName = normalizeAdminEmployeeDisplayName(w.employeeName ?? "")
      const dedupeKey = `${uid}|${w.workDate}|${w.warningType}|${w.message}|${checkInOriginal}|${checkOutOriginal}`
      if (!dedupMap.has(dedupeKey)) {
        dedupMap.set(dedupeKey, {
          userId: uid,
          employeeName,
          workDate: w.workDate,
          warningType: w.warningType,
          checkInOriginal,
          checkOutOriginal,
          compactMessage: toCompactWarningMessage(w.warningType, w.message),
          message: w.message,
        })
      }
    }
    const dedupedWarnings = Array.from(dedupMap.values())
    const employeeOrderMap = new Map<string, number>(ADMIN_EMPLOYEE_ORDER.map((name, index) => [name, index]))
    const fallbackOrderBase = ADMIN_EMPLOYEE_ORDER.length
    const finalWarningRows = dedupedWarnings.sort((a, b) => {
      const byDate = a.workDate.localeCompare(b.workDate)
      if (byDate !== 0) return byDate
      const aOrder = employeeOrderMap.get(a.employeeName) ?? fallbackOrderBase
      const bOrder = employeeOrderMap.get(b.employeeName) ?? fallbackOrderBase
      if (aOrder !== bOrder) return aOrder - bOrder
      const byType = getWarningTypeOrder(a.warningType) - getWarningTypeOrder(b.warningType)
      if (byType !== 0) return byType
      return a.employeeName.localeCompare(b.employeeName, "ko")
    })

    console.log("[admin warnings] raw warnings:", safeWarnings.length)
    console.log("[admin warnings] mapped warnings:", mappedWarnings.length)
    console.log("[admin warnings] deduped warnings:", dedupedWarnings.length)
    console.log("[admin warnings] final warnings:", finalWarningRows)

    return finalWarningRows
  }, [isAdminUser, filteredMergedWarnings, selectedEmployeeName])

  const dbWarningDateSet = useMemo(
    () => new Set(filteredDbWarnings.map((w) => w.workDate)),
    [filteredDbWarnings],
  )

  const attendanceData = useMemo(
    () =>
      isAdminUser
        ? mapAdminAttendanceRows(filteredAttendanceRows, adminEmployeeNameByUserId, adminFilteredWarnings)
        : mergeAttendanceRecordsWithWarnings(filteredAttendanceRows, filteredMergedWarnings, dbWarningDateSet),
    [
      isAdminUser,
      filteredAttendanceRows,
      adminEmployeeNameByUserId,
      adminFilteredWarnings,
      filteredMergedWarnings,
      dbWarningDateSet,
    ],
  )

  const attendanceEmptyMessage = useMemo(() => {
    if (!isAdminUser) return attendanceErrorMessage ?? "근태 데이터가 없습니다"
    if (normalizeAdminEmployeeDisplayName(selectedEmployeeName) === ALL_EMPLOYEES_LABEL) {
      return "선택한 월에 직원 근태 데이터가 없습니다"
    }
    return `${normalizeAdminEmployeeDisplayName(selectedEmployeeName)}님의 해당 월 근태 데이터가 없습니다`
  }, [isAdminUser, selectedEmployeeName, attendanceErrorMessage])

  const summary = useMemo(() => getAttendanceSummary(filteredAttendanceRows), [filteredAttendanceRows])
  if (isAdminUser) {
    console.log("[admin attendance] selectedEmployeeName:", selectedEmployeeName)
    console.log("[admin attendance] filteredRecords:", filteredAttendanceRows)
    console.log("[admin attendance] final display rows:", attendanceData.length)
    console.log("[admin attendance] sample rows:", attendanceData.slice(0, 10))
  }
  const adminOrderedEmployees = useMemo(() => {
    const names = Array.from(adminEmployeeNameByUserId.values()).filter((name) => Boolean(name.trim()))
    if (names.length === 0) return [...ADMIN_EMPLOYEE_ORDER]
    const orderMap = new Map<string, number>(ADMIN_EMPLOYEE_ORDER.map((name, index) => [name, index]))
    return [...new Set(names)].sort((a, b) => {
      const ai = orderMap.get(a) ?? Number.MAX_SAFE_INTEGER
      const bi = orderMap.get(b) ?? Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi
      return a.localeCompare(b, "ko")
    })
  }, [adminEmployeeNameByUserId])

  const adminSummary = useMemo<AdminSummary>(() => {
    if (!isAdminUser) {
      return {
        totalEmployees: 0,
        uploadedEmployees: 0,
        notUploadedEmployees: 0,
        employeesWithWarning: 0,
        totalLateCount: 0,
        totalUnder9hCount: 0,
        totalOvertimeMinutes: 0,
        specialWorkDays: 0,
      }
    }

    const uploadedEmployeeSet = new Set<string>()
    const warningEmployeeSet = new Set<string>()
    let totalLateCount = 0
    let totalUnder9hCount = 0
    let totalOvertimeMinutes = 0
    const specialWorkDateSet = new Set<string>()

    for (const row of allAttendanceRows) {
      const uid = String(row.user_id ?? "")
      const employeeName = uid ? adminEmployeeNameByUserId.get(uid) ?? "" : ""
      if (!employeeName) continue
      uploadedEmployeeSet.add(employeeName)
      const { effectiveMinutes, sameClock } = effectiveWorkMinutesFromAttendanceRow(row)
      const isUnder9 = Boolean(row.is_under_9h) || sameClock || (effectiveMinutes !== null && effectiveMinutes <= MAX_NORMAL_WORK_MINUTES)

      if (row.is_late) totalLateCount += 1
      if (isUnder9) totalUnder9hCount += 1
      if ((row.overtime_minutes ?? 0) > 0) totalOvertimeMinutes += Math.max(0, row.overtime_minutes ?? 0)
      if (row.is_special_workday) specialWorkDateSet.add(row.work_date)
      if (row.is_late || isUnder9 || sameClock) warningEmployeeSet.add(employeeName)
    }

    const totalEmployees = adminOrderedEmployees.length
    const uploadedEmployees = uploadedEmployeeSet.size
    return {
      totalEmployees,
      uploadedEmployees,
      notUploadedEmployees: Math.max(0, totalEmployees - uploadedEmployees),
      employeesWithWarning: warningEmployeeSet.size,
      totalLateCount,
      totalUnder9hCount,
      totalOvertimeMinutes,
      specialWorkDays: specialWorkDateSet.size,
    }
  }, [isAdminUser, allAttendanceRows, adminEmployeeNameByUserId, adminOrderedEmployees])

  /** 선택 연·월 기준, 고정 9명 중 해당 월 근태 행이 없는 직원 */
  const adminNotUploadedCanonicalNames = useMemo(() => {
    if (!isAdminUser) return [] as string[]
    const uploaded = new Set<string>()
    for (const row of allAttendanceRows) {
      const uid = String(row.user_id ?? "")
      const name = uid ? adminEmployeeNameByUserId.get(uid) ?? "" : ""
      if (name && ADMIN_EMPLOYEE_NAME_SET.has(name)) uploaded.add(name)
    }
    return ADMIN_EMPLOYEE_ORDER.filter((n) => !uploaded.has(n))
  }, [isAdminUser, allAttendanceRows, adminEmployeeNameByUserId])

  /** 이상이 있는 일수(행) 기준, 9명 중 상위 3명 */
  const adminTopAnomalyEmployees = useMemo((): AdminTopAnomalyEntry[] => {
    if (!isAdminUser) return []
    const counts = new Map<string, number>()
    for (const row of allAttendanceRows) {
      if (!adminRowHasAnyAnomaly(row)) continue
      const uid = String(row.user_id ?? "")
      const name = uid ? adminEmployeeNameByUserId.get(uid) ?? "" : ""
      if (!name || !ADMIN_EMPLOYEE_NAME_SET.has(name)) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return ADMIN_EMPLOYEE_ORDER.map((name) => ({ name, count: counts.get(name) ?? 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"))
      .slice(0, 3)
  }, [isAdminUser, allAttendanceRows, adminEmployeeNameByUserId])

  /** 날짜 최신순 이상 건, 최대 5건 노출 */
  const adminPriorityCheck = useMemo(() => {
    if (!isAdminUser) return { items: [] as AdminPriorityCheckItem[], restCount: 0 }
    const flagged: AdminPriorityCheckItem[] = []
    for (const row of allAttendanceRows) {
      const { hasIssue, kindLabel } = classifyAdminRowPriorityKind(row)
      if (!hasIssue) continue
      const uid = String(row.user_id ?? "")
      const name = uid ? adminEmployeeNameByUserId.get(uid) ?? "" : ""
      if (!name) continue
      flagged.push({ employeeName: name, workDate: row.work_date, kindLabel })
    }
    flagged.sort((a, b) => {
      const byDate = b.workDate.localeCompare(a.workDate)
      if (byDate !== 0) return byDate
      return a.employeeName.localeCompare(b.employeeName, "ko")
    })
    return {
      items: flagged.slice(0, 5),
      restCount: Math.max(0, flagged.length - 5),
    }
  }, [isAdminUser, allAttendanceRows, adminEmployeeNameByUserId])

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
    if (isAdminUser) {
      for (const row of allAttendanceRows) {
        const { effectiveMinutes, sameClock } = effectiveWorkMinutesFromAttendanceRow(row)
        const hasWarning =
          Boolean(row.is_late) || sameClock || (effectiveMinutes !== null && effectiveMinutes <= MAX_NORMAL_WORK_MINUTES)
        if (hasWarning && isIsoInRange(row.work_date, calendarMonthRange)) {
          s.add(row.work_date)
        }
      }
      return s
    }
    for (const w of allMergedWarnings) {
      if (isIsoInRange(w.workDate, calendarMonthRange)) s.add(w.workDate)
    }
    return s
  }, [isAdminUser, allAttendanceRows, allMergedWarnings, calendarMonthRange])

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

  const navigateSelectedMonth = useCallback(
    (dir: -1 | 1) => {
      let nextYear = selectedYear
      let nextMonth = selectedMonth + dir
      if (nextMonth > 12) {
        nextMonth = 1
        nextYear += 1
      } else if (nextMonth < 1) {
        nextMonth = 12
        nextYear -= 1
      }
      setSelectedYear(nextYear)
      setSelectedMonth(nextMonth)
      setPeriodSelection((p) => {
        const dim = new Date(nextYear, nextMonth, 0).getDate()
        return { year: nextYear, month: nextMonth, day: Math.min(p.day, dim) }
      })
    },
    [selectedYear, selectedMonth],
  )

  const handleGenerateFinalExcel = async () => {
    const cacheBust = `t=${Date.now()}`
    const templateRequestPath = `${TEMPLATE_URL_PATH}?${cacheBust}`
    const templateRequestUrl =
      typeof window !== "undefined"
        ? new URL(templateRequestPath, window.location.origin).toString()
        : templateRequestPath
    const templateLogContext = () => ({
      templateUrlPath: TEMPLATE_URL_PATH,
      publicFileSystemPath: "public/templates/template.xlsx",
      templateRequestUrl,
    })

    try {
      setFinalExcelMessage(null)
      setIsGeneratingFinalExcel(true)

      const exportYear = selectedYear
      const exportMonth = selectedMonth
      console.log(`[final-collect-excel] selected: ${exportYear}-${pad2(exportMonth)}`)

      const { data: profileRows, error: profileError } = await supabase
        .from("profiles")
        .select("id, name, role, email")

      if (profileError) {
        console.error("[final-collect-excel] profile query error:", profileError.message, templateLogContext())
        setFinalExcelMessage(profileError.message)
        return
      }

      const rawProfiles = (profileRows ?? []) as ProfileNameRow[]
      const employeeProfiles = rawProfiles.filter((p) => p.role === "employee" && !isAdminProfile(p))
      const employeeUserIds = employeeProfiles.map((p) => p.id)
      const employeeUserIdSet = new Set(employeeUserIds)
      const employeeNameByUserId = new Map<string, string>(
        employeeProfiles.map((p) => [p.id, (p.name ?? "").trim()]),
      )
      console.log("[final-collect-excel] employee profiles count:", employeeProfiles.length)

      if (employeeUserIds.length === 0) {
        setFinalExcelMessage("취합할 직원 근태 데이터가 없습니다")
        return
      }

      const attendanceSelect =
        "user_id, work_date, check_in, check_out, total_minutes, overtime_minutes, year, month, work_status"
      const targetYear = exportYear
      const targetMonth = exportMonth
      console.log(`[final-collect-excel] export target: ${targetYear}-${pad2(targetMonth)}`)

      const monthStr = String(targetMonth).padStart(2, "0")
      const startDate = `${targetYear}-${monthStr}-01`
      const nextMonthDate =
        targetMonth === 12
          ? `${targetYear + 1}-01-01`
          : `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-01`
      console.log("조회 범위:", startDate, nextMonthDate)

      const targetResult = await supabase
        .from("attendance_records")
        .select(attendanceSelect)
        .gte("work_date", startDate)
        .lt("work_date", nextMonthDate)
        .in("user_id", employeeUserIds)

      if (targetResult.error) {
        console.error("[final-collect-excel] target records query error:", targetResult.error.message)
        setFinalExcelMessage(targetResult.error.message)
        return
      }

      const targetRows = (targetResult.data ?? []) as Array<AttendanceExportRow & { overtime_minutes?: number | null }>

      const filteredRows = targetRows.filter((row) => {
        const name = (employeeNameByUserId.get(row.user_id) ?? "").trim()
        if (!employeeUserIdSet.has(row.user_id) || name === "관리자") {
          console.log("[final-collect-excel] admin record skipped")
          return false
        }
        return true
      })

      console.log("[final-collect-excel] records count:", filteredRows.length)
      console.log("[final-collect-excel] employee profiles count:", employeeProfiles.length)
      if (filteredRows.length === 0) {
        setFinalExcelMessage("선택한 월에 취합할 직원 근태 데이터가 없습니다. 다른 월을 선택해주세요.")
        return
      }

      const templateResponse = await fetch(templateRequestUrl, { cache: "no-store" })
      console.log("[final-collect-excel] template fetch request URL:", templateRequestUrl)
      if (!templateResponse.ok) {
        const msg =
          templateResponse.status === 404
            ? "템플릿 파일을 찾을 수 없습니다"
            : `템플릿 로드 실패 (${templateResponse.status})`
        setFinalExcelMessage(`${msg}: ${templateRequestUrl}`)
        console.error("[final-collect-excel] template fetch failed", {
          status: templateResponse.status,
          statusText: templateResponse.statusText,
          ...templateLogContext(),
        })
        return
      }

      const templateBuffer = await templateResponse.arrayBuffer()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(templateBuffer)
      console.log("[final-collect-excel] workbook SheetNames:", workbook.worksheets.map((w) => w.name))

      const worksheet = workbook.worksheets[0]
      if (!worksheet) {
        console.error("[final-collect-excel] template workbook has no sheets", templateLogContext())
        setFinalExcelMessage("템플릿 시트를 찾을 수 없습니다")
        return
      }

      // 상단 1~4행 불필요 영역 제거 후, 제목/헤더/데이터를 1~4행 구조로 재배치
      worksheet.spliceRows(1, 4)
      worksheet.views = [{ state: "normal" }]

      const THIN_GRID_SIDE: ExcelJS.Border = { style: "thin", color: { argb: "FF000000" } }

      const excelColIndexToLetters = (col1Based: number): string => {
        let n = col1Based
        let s = ""
        while (n > 0) {
          const rem = (n - 1) % 26
          s = String.fromCharCode(65 + rem) + s
          n = Math.floor((n - 1) / 26)
        }
        return s
      }

      const mergeDimToAddress = (dim: { top: number; left: number; bottom: number; right: number }) =>
        `${excelColIndexToLetters(dim.left)}${dim.top}:${excelColIndexToLetters(dim.right)}${dim.bottom}`

      /** C4:T34·M:N·O:P·W:X 등 데이터/범례 방해 병합 전부 해제 (데이터 영역은 단일 셀만) */
      const unmergeC4T34DataAreaCompletely = () => {
        const explicitData = ["C4:T34", "M4:N34", "O4:P34"]
        for (const addr of explicitData) {
          try {
            worksheet.unMergeCells(addr)
          } catch {
            // ignore
          }
        }
        const mergeBandsWx = ["V1:Z40", "W1:X40", "W5:X35", "W4:X36", "U1:X40", "M4:N34", "O4:P34"]
        for (const addr of mergeBandsWx) {
          try {
            worksheet.unMergeCells(addr)
          } catch {
            // ignore
          }
        }
        const mergeModelRoot = mergeModelAccessor()
        for (let guard = 0; guard < 200; guard += 1) {
          const model = mergeModelRoot._merges
          if (!model) break
          let removed = false
          for (const [, dim] of Object.entries(model)) {
            if (!dim || !mergeRangeIntersectsC4T34(dim)) continue
            removed = true
            try {
              worksheet.unMergeCells(mergeDimToAddress(dim))
            } catch {
              // ignore
            }
          }
          if (!removed) break
        }
      }

      const setDataCellFillWhite = (cell: ExcelJS.Cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: WHITE_FILL_ARGB },
        }
      }

      const applyFillFinal = (cell: ExcelJS.Cell, color: string) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: color },
        }
      }

      const mergeModelAccessor = () =>
        worksheet as unknown as {
          _merges?: Record<string, { top: number; left: number; bottom: number; right: number }>
        }

      /** A1:U34 thin grid만 설정(fill·value·font는 변경하지 않음) */
      const applyA1U34DataGridThinBordersOnly = () => {
        const mergeModelRoot = mergeModelAccessor()
        for (let r = 1; r <= 34; r += 1) {
          for (let c = 1; c <= 21; c += 1) {
            const cell = worksheet.getCell(r, c)
            cell.border = {
              top: THIN_GRID_SIDE,
              left: THIN_GRID_SIDE,
              bottom: THIN_GRID_SIDE,
              right: THIN_GRID_SIDE,
            }
          }
        }
        const mergeModelBorders = mergeModelRoot._merges
        if (mergeModelBorders) {
          for (const dim of Object.values(mergeModelBorders)) {
            if (!dim) continue
            const overlaps = dim.left <= 21 && dim.right >= 1 && dim.top <= 34 && dim.bottom >= 1
            if (!overlaps) continue
            const r0 = Math.max(1, dim.top)
            const r1 = Math.min(34, dim.bottom)
            const c0 = Math.max(1, dim.left)
            const c1 = Math.min(21, dim.right)
            for (let r = r0; r <= r1; r += 1) {
              for (let c = c0; c <= c1; c += 1) {
                const cell = worksheet.getCell(r, c)
                cell.border = {
                  top: THIN_GRID_SIDE,
                  left: THIN_GRID_SIDE,
                  bottom: THIN_GRID_SIDE,
                  right: THIN_GRID_SIDE,
                }
              }
            }
          }
        }
      }

      /** 병합 해제 + 행·열 크기 (색/테두리/범례/X는 저장 직전 파이프라인에서 처리) */
      const finalExcelUnmergeAndDimensions = () => {
        unmergeC4T34DataAreaCompletely()

        worksheet.getRow(1).height = 24
        worksheet.getRow(2).height = 20
        worksheet.getRow(3).height = 20
        for (let r = TEMPLATE_DATE_START_ROW; r <= TEMPLATE_DATE_END_ROW; r += 1) {
          worksheet.getRow(r).height = 18
        }

        worksheet.getColumn(1).width = 10
        worksheet.getColumn(2).width = 6
        for (let c = 3; c <= 20; c += 1) {
          worksheet.getColumn(c).width = 8
        }
        worksheet.getColumn(21).width = 45
        worksheet.getColumn(23).width = 16
      }

      /** C4:T34·날짜열·비고 본문 + 제목 행 글꼴·정렬 (fill 변경 없음) */
      const applyC4T34AndBodyFontAlignment = () => {
        for (let r = TEMPLATE_DATE_START_ROW; r <= TEMPLATE_DATE_END_ROW; r += 1) {
          for (let c = 3; c <= 20; c += 1) {
            const cell = worksheet.getCell(r, c)
            cell.font = {
              name: "맑은 고딕",
              size: 10,
              bold: false,
              color: { argb: "FF000000" },
            }
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: false }
          }
        }

        for (let c = 1; c <= 20; c += 1) {
          const h = worksheet.getCell(1, c)
          h.font = {
            name: "맑은 고딕",
            size: 16,
            bold: true,
            color: { argb: "FF000000" },
          }
          h.alignment = { horizontal: "center", vertical: "middle", wrapText: false }
        }

        for (let r = 2; r <= 3; r += 1) {
          for (let c = 1; c <= 21; c += 1) {
            const cell = worksheet.getCell(r, c)
            cell.font = {
              name: "맑은 고딕",
              size: 10,
              bold: true,
              color: { argb: "FF000000" },
            }
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: false }
          }
        }

        const daysInMonthPost = new Date(targetYear, targetMonth, 0).getDate()
        for (let r = TEMPLATE_DATE_START_ROW; r <= TEMPLATE_DATE_END_ROW; r += 1) {
          const day = r - 3
          const inMonth = day >= 1 && day <= daysInMonthPost
          const date = new Date(targetYear, targetMonth - 1, day)
          const dayOfWeek = date.getDay()
          const isWeekend = inMonth && (dayOfWeek === 0 || dayOfWeek === 6)
          for (let c = 1; c <= 2; c += 1) {
            const cell = worksheet.getCell(r, c)
            cell.font = {
              name: "맑은 고딕",
              size: 10,
              bold: isWeekend,
              color: isWeekend ? { argb: "FFFF0000" } : { argb: "FF000000" },
            }
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: false }
          }
          const uBody = worksheet.getCell(r, 21)
          uBody.font = {
            name: "맑은 고딕",
            size: 10,
            bold: false,
            color: { argb: "FF000000" },
          }
          uBody.alignment = { horizontal: "left", vertical: "middle", wrapText: true }
        }
      }

      /** W열만 범례 (X열·W:X 병합 사용 안 함) */
      const applyFinalExcelLegendWColumnOnly = () => {
        const legendRowSet = new Set(FINAL_EXCEL_LEGEND_ROWS.map((x) => x.row))
        for (let r = 1; r <= 40; r += 1) {
          const wCell = worksheet.getCell(r, 23)
          if (!legendRowSet.has(r)) {
            wCell.value = null
            wCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE_FILL_ARGB } }
            wCell.border = {}
            wCell.font = {}
            wCell.alignment = {}
          }
        }
        for (const item of FINAL_EXCEL_LEGEND_ROWS) {
          const c = worksheet.getCell(item.row, 23)
          c.value = item.label
          c.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: STATUS_COLOR_MAP[item.label] ?? WHITE_FILL_ARGB },
          }
          c.font = {
            name: "맑은 고딕",
            size: 10,
            bold: true,
            color: { argb: "FF000000" },
          }
          c.alignment = { horizontal: "center", vertical: "middle", wrapText: false }
          c.border = {
            top: { style: "thin", color: { argb: LEGEND_BORDER_ARGB } },
            left: { style: "thin", color: { argb: LEGEND_BORDER_ARGB } },
            bottom: { style: "thin", color: { argb: LEGEND_BORDER_ARGB } },
            right: { style: "thin", color: { argb: LEGEND_BORDER_ARGB } },
          }
        }
      }

      /** 저장 직전 마지막: X1:X40 완전 초기화 (값·색·테두리 없음) */
      const clearFinalExcelXColumnLast = () => {
        for (let row = 1; row <= 40; row += 1) {
          const cell = worksheet.getCell(`X${row}`)
          cell.value = null
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: WHITE_FILL_ARGB },
          }
          cell.border = {}
          cell.font = {
            name: "맑은 고딕",
            size: 10,
            bold: false,
            color: { argb: "FF000000" },
          }
          cell.alignment = { horizontal: "center", vertical: "middle" }
        }
      }

      /** 근무시간 기준 색상 재계산·적용 (적용 후 C4:T34 흰색 초기화 없음) */
      const runFinalExcelStep10ApplyColorsFromMappedRows = (
        rows: Array<(AttendanceExportRow & { overtime_minutes?: number | null }) & { name: string; day: number }>,
      ) => {
        for (const rec of rows) {
          const name = rec.name
          const work_date = rec.work_date
          const check_in = rec.check_in
          const check_out = rec.check_out
          const cols = getMappedEmployeeColumns(name)
          if (!cols) continue

          const rawIn = String(check_in ?? "").trim()
          const rawOut = String(check_out ?? "").trim()
          const hasCheckIn = rawIn !== "" && rawIn !== "-"
          const hasCheckOut = rawOut !== "" && rawOut !== "-"

          const checkInMin = timeToMinutes(check_in ?? null)
          const checkOutMin = timeToMinutes(check_out ?? null)

          const calculatedTotalMinutes =
            checkInMin !== null && checkOutMin !== null ? checkOutMin - checkInMin : null

          const calculatedOvertimeMinutes =
            checkOutMin !== null && checkOutMin > 17 * 60 ? checkOutMin - 17 * 60 : 0

          const parsed = parseIsoDate(work_date)
          const isWeekend = parsed ? parsed.getDay() === 0 || parsed.getDay() === 6 : false
          const isHoliday = parsed ? isLegalHoliday(parsed) : false

          const statusUpper = String(rec.work_status ?? "").toUpperCase()
          let anomalyMarker: string | null = null
          for (const marker of WORK_STATUS_ANOMALY_MARKERS) {
            if (statusUpper.includes(marker)) {
              anomalyMarker = marker
              break
            }
          }

          const isInvalid =
            anomalyMarker !== null ||
            !hasCheckIn ||
            !hasCheckOut ||
            checkInMin === null ||
            checkOutMin === null ||
            checkInMin === checkOutMin ||
            checkOutMin < checkInMin

          const totalMinutesDb =
            rec.total_minutes != null && Number.isFinite(Number(rec.total_minutes)) ? Number(rec.total_minutes) : null
          const overtimeMinutesDb =
            rec.overtime_minutes != null && Number.isFinite(Number(rec.overtime_minutes))
              ? Number(rec.overtime_minutes)
              : null

          const isOvertime =
            (overtimeMinutesDb !== null && overtimeMinutesDb >= 59) ||
            (totalMinutesDb !== null && totalMinutesDb > 600) ||
            calculatedOvertimeMinutes >= 59 ||
            (calculatedTotalMinutes !== null && calculatedTotalMinutes > 600)

          const isWeekendOrHolidayWork = (isWeekend || isHoliday) && (hasCheckIn || hasCheckOut)

          const isLate = checkInMin !== null && checkInMin > 9 * 60

          let status: "이상" | "특근" | "추가근무" | "지각" | null = null
          if (isInvalid) {
            status = "이상"
          } else if (isWeekendOrHolidayWork) {
            status = "특근"
          } else if (isOvertime) {
            status = "추가근무"
          } else if (isLate) {
            status = "지각"
          }

          const row = rec.day + 3
          const inCol = cols.checkInCol
          const outCol = cols.checkOutCol

          console.log("[excel color check]", {
            name,
            work_date,
            check_in,
            check_out,
            checkInMin,
            checkOutMin,
            calculatedTotalMinutes,
            calculatedOvertimeMinutes,
            overtime_minutes: rec.overtime_minutes,
            total_minutes: rec.total_minutes,
            isWeekend,
            isHoliday,
            status,
            row,
            inCol,
            outCol,
          })

          const inCell = worksheet.getCell(`${inCol}${row}`)
          const outCell = worksheet.getCell(`${outCol}${row}`)

          if (!status) {
            setDataCellFillWhite(inCell)
            setDataCellFillWhite(outCell)
            continue
          }

          const argb = STATUS_COLOR_MAP[status]
          if (!argb) {
            setDataCellFillWhite(inCell)
            setDataCellFillWhite(outCell)
            continue
          }

          if (status === "지각") {
            applyFillFinal(inCell, argb)
            setDataCellFillWhite(outCell)
          } else {
            applyFillFinal(inCell, argb)
            applyFillFinal(outCell, argb)
          }

          if (status === "이상") {
            const noteCell = worksheet.getCell(`U${row}`)
            let reason = "확인 필요"
            if (anomalyMarker) reason = anomalyMarker
            else if (!hasCheckIn) reason = "출근 누락"
            else if (!hasCheckOut) reason = "퇴근 누락"
            else if ((hasCheckIn && checkInMin === null) || (hasCheckOut && checkOutMin === null)) reason = "시간 형식 오류"
            else if (checkInMin !== null && checkOutMin !== null && checkInMin === checkOutMin) reason = "출근/퇴근 동일"
            else if (checkInMin !== null && checkOutMin !== null && checkOutMin < checkInMin) reason = "퇴근<출근"

            const prev =
              typeof noteCell.value === "string"
                ? noteCell.value.trim()
                : noteCell.value
                  ? String(noteCell.value).trim()
                  : ""
            const noteText = `${name}: ${reason}`
            noteCell.value = prev ? `${prev} / ${noteText}` : noteText
            applyFillFinal(noteCell, STATUS_COLOR_MAP["이상"] ?? "FFF4CCCC")
          }
        }
      }

      // 제목(A1:T1) 초기화 + 병합 + 중앙정렬
      try {
        // 기존 병합이 남아 있으면 해제 시도
        worksheet.unMergeCells("A1:T1")
      } catch {
        // ignore
      }
      for (let colCode = 65; colCode <= 84; colCode += 1) {
        const col = String.fromCharCode(colCode)
        worksheet.getCell(`${col}1`).value = null
      }
      worksheet.mergeCells("A1:T1")
      const titleCell = worksheet.getCell("A1")
      titleCell.value = `${targetYear}년 ${targetMonth}월 3Camp 기술2팀 출근부`
      titleCell.alignment = { horizontal: "center", vertical: "middle" }
      titleCell.font = { ...(titleCell.font ?? {}), bold: true, size: 16 }

      // 날짜/요일 헤더 중복 방지: A2:A3, B2:B3 병합
      try {
        worksheet.unMergeCells("A2:A3")
      } catch {
        // ignore
      }
      try {
        worksheet.unMergeCells("B2:B3")
      } catch {
        // ignore
      }
      worksheet.mergeCells("A2:A3")
      worksheet.mergeCells("B2:B3")
      const a2 = worksheet.getCell("A2")
      const b2 = worksheet.getCell("B2")
      a2.value = "날짜"
      b2.value = "요일"
      a2.alignment = { horizontal: "center", vertical: "middle" }
      b2.alignment = { horizontal: "center", vertical: "middle" }
      a2.font = { ...(a2.font ?? {}), bold: true }
      b2.font = { ...(b2.font ?? {}), bold: true }

      // 비고(U2:U3) 병합해 중복 제거
      try {
        worksheet.unMergeCells("U2:U3")
      } catch {
        // ignore
      }
      worksheet.mergeCells("U2:U3")
      const u2 = worksheet.getCell("U2")
      u2.value = "비고"
      u2.alignment = { horizontal: "center", vertical: "middle" }
      u2.font = { ...(u2.font ?? {}), bold: true }

      // 직원 이름 헤더 병합(C2:T2) + 중앙정렬 + 출근/퇴근(3행) 라벨 강제
      const employeeHeaderMerges: Array<{ name: string; startCol: string; endCol: string }> = [
        { name: "장영광", startCol: "C", endCol: "D" },
        { name: "심종하", startCol: "E", endCol: "F" },
        { name: "오민석", startCol: "G", endCol: "H" },
        { name: "권태준", startCol: "I", endCol: "J" },
        { name: "김정훈", startCol: "K", endCol: "L" },
        { name: "이민성", startCol: "M", endCol: "N" },
        { name: "김희수", startCol: "O", endCol: "P" },
        { name: "김선태", startCol: "Q", endCol: "R" },
        { name: "윤효준", startCol: "S", endCol: "T" },
      ]
      for (const h of employeeHeaderMerges) {
        const range = `${h.startCol}2:${h.endCol}2`
        try {
          worksheet.unMergeCells(range)
        } catch {
          // ignore
        }
        // 중복 텍스트 제거 후 병합
        worksheet.getCell(`${h.startCol}2`).value = null
        worksheet.getCell(`${h.endCol}2`).value = null
        worksheet.mergeCells(range)
        const headCell = worksheet.getCell(`${h.startCol}2`)
        headCell.value = h.name
        headCell.alignment = { horizontal: "center", vertical: "middle" }
        headCell.font = {
          ...(headCell.font ?? {}),
          name: "맑은 고딕",
          size: 10,
          bold: true,
          color: { argb: "FF000000" },
        }
        worksheet.getCell(`${h.startCol}3`).value = "출근"
        worksheet.getCell(`${h.endCol}3`).value = "퇴근"
        worksheet.getCell(`${h.startCol}3`).alignment = { horizontal: "center", vertical: "middle" }
        worksheet.getCell(`${h.endCol}3`).alignment = { horizontal: "center", vertical: "middle" }
      }

      // 헤더(행 1~3) 폰트/정렬 강제 통일
      for (let r = 1; r <= 3; r += 1) {
        for (let c = 1; c <= 21; c += 1) {
          const cell = worksheet.getCell(r, c)
          cell.alignment = { horizontal: "center", vertical: "middle" }
          cell.font = {
            name: "맑은 고딕",
            size: r === 1 ? 16 : 10,
            bold: true,
            color: { argb: "FF000000" },
          }
        }
      }

      const dedupByUserDate = new Map<string, AttendanceExportRow & { overtime_minutes?: number | null }>()
      for (const row of filteredRows) {
        dedupByUserDate.set(`${row.user_id}|${row.work_date}`, row)
      }
      const dedupedRows = Array.from(dedupByUserDate.values())

      let skippedNoProfileCount = 0
      let skippedMappingCount = 0
      let skippedInvalidDayCount = 0
      const mappedRows: Array<(AttendanceExportRow & { overtime_minutes?: number | null }) & { name: string; day: number }> = []
      for (const row of dedupedRows) {
        const name = (employeeNameByUserId.get(row.user_id) ?? "").trim()
        if (!name) {
          skippedNoProfileCount += 1
          console.warn("[final-collect-excel] profiles 매칭 실패:", row.user_id, row.work_date)
          continue
        }
        const cols = getMappedEmployeeColumns(name)
        if (!cols) {
          skippedMappingCount += 1
          console.warn(`[final-collect-excel] employee column mapping failed: ${name}, ${row.user_id}`)
          continue
        }
        const day = Number(String(row.work_date).slice(8, 10))
        if (!Number.isFinite(day) || day < 1 || day > 31) {
          skippedInvalidDayCount += 1
          continue
        }
        mappedRows.push({ ...row, name, day })
      }

      const rowsByNameDay = new Map<string, (AttendanceExportRow & { overtime_minutes?: number | null }) & { name: string; day: number }>()
      for (const row of mappedRows) rowsByNameDay.set(`${row.name}|${row.day}`, row)

      const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"] as const
      const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
      let writtenCellsCount = 0

      finalExcelUnmergeAndDimensions()

      // 저장 직전 파이프라인 1) C4:T34·비고(U) 흰색 초기화 (색 적용 후에는 다시 흰색 칠하지 않음)
      for (let row = TEMPLATE_DATE_START_ROW; row <= TEMPLATE_DATE_END_ROW; row += 1) {
        for (const col of "CDEFGHIJKLMNOPQRST") {
          const cell = worksheet.getCell(`${col}${row}`)
          cell.value = null
          setDataCellFillWhite(cell)
          cell.border = {}
          cell.font = {}
          cell.alignment = {}
        }
        const uCell = worksheet.getCell(`U${row}`)
        uCell.value = null
        setDataCellFillWhite(uCell)
        uCell.border = {}
        uCell.font = {}
        uCell.alignment = {}
      }

      // 2) 출근/퇴근·날짜 데이터 입력
      for (let day = 1; day <= 31; day += 1) {
        const rowIndex = day + 3
        const workDate = `${targetYear}-${pad2(targetMonth)}-${pad2(day)}`
        const dateCell = `${DATE_COLUMN}${rowIndex}`
        const weekdayCell = `${WEEKDAY_COLUMN}${rowIndex}`

        if (day <= daysInMonth) {
          const parsedDate = parseIsoDate(workDate) ?? new Date(`${workDate}T00:00:00`)
          const dateCellRef = worksheet.getCell(dateCell)
          const weekdayCellRef = worksheet.getCell(weekdayCell)
          dateCellRef.value = `${pad2(targetMonth)}월 ${pad2(day)}일`
          weekdayCellRef.value = weekdayNames[parsedDate.getDay()]
          if (isSpecialWorkDate(workDate)) {
            dateCellRef.font = {
              name: "맑은 고딕",
              size: 10,
              bold: false,
              color: { argb: "FFDC2626" },
            }
            weekdayCellRef.font = {
              name: "맑은 고딕",
              size: 10,
              bold: false,
              color: { argb: "FFDC2626" },
            }
          } else {
            dateCellRef.font = {
              name: "맑은 고딕",
              size: 10,
              bold: false,
              color: { argb: "FF000000" },
            }
            weekdayCellRef.font = {
              name: "맑은 고딕",
              size: 10,
              bold: false,
              color: { argb: "FF000000" },
            }
          }
        } else {
          worksheet.getCell(dateCell).value = null
          worksheet.getCell(weekdayCell).value = null
          continue
        }

        for (const [name, { checkInCol, checkOutCol }] of Object.entries(EMPLOYEE_COLUMN_MAP)) {
          const checkInCell = `${checkInCol}${rowIndex}`
          const checkOutCell = `${checkOutCol}${rowIndex}`
          const rowData = rowsByNameDay.get(`${name}|${day}`)
          const inText = formatCheckInOutForCell(rowData?.check_in ?? null)
          const outText = formatCheckInOutForCell(rowData?.check_out ?? null)
          const inCellRef = worksheet.getCell(checkInCell)
          const outCellRef = worksheet.getCell(checkOutCell)
          inCellRef.value = inText || null
          outCellRef.value = outText || null

          if (rowData && (inText || outText)) {
            writtenCellsCount += 1
            console.log("[excel] write record", name, rowData.work_date, rowData.check_in ?? "-", rowData.check_out ?? "-")
          }
        }
      }

      console.log("[final-collect-excel] written cells count:", writtenCellsCount)
      console.log("[final-collect-excel] skipped summary:", {
        noProfile: skippedNoProfileCount,
        noColumnMapping: skippedMappingCount,
        invalidDay: skippedInvalidDayCount,
      })
      if (writtenCellsCount === 0) {
        setFinalExcelMessage("취합된 직원 데이터가 없습니다. 업로드 월과 선택 월을 확인해주세요.")
        return
      }

      // 저장 직전: 5) 글꼴/정렬 → 6) W 범례 → (병합 재확인) → 7) 색상 → 8) A1:U34 테두리 → 9) X 초기화
      applyC4T34AndBodyFontAlignment()
      applyFinalExcelLegendWColumnOnly()
      console.log("[excel final] legend W only completed")
      unmergeC4T34DataAreaCompletely()
      runFinalExcelStep10ApplyColorsFromMappedRows(mappedRows)
      applyA1U34DataGridThinBordersOnly()
      console.log("[excel final] border reapplied A1:U34")
      clearFinalExcelXColumnLast()
      console.log("[excel final] clear X column completed")

      const output = await workbook.xlsx.writeBuffer()
      const blob = new Blob([output], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${targetMonth}월 3Camp 기술2팀 출근부.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("[final-collect-excel] unexpected error:", error, templateLogContext())
      setFinalExcelMessage("최종 취합 엑셀 생성 중 오류가 발생했습니다")
    } finally {
      setIsGeneratingFinalExcel(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 인사 문구 */}
        <EmployeeDashboardGreeting isAdminUser={isAdminUser} />

        {/* 통계 카드 + (직원: 미니 달력 / 관리자: 확인 요약) */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isAdminUser ? (
            <>
              <StatCard title="전체 직원 수" value={`${adminSummary.totalEmployees}명`} icon={Users} variant="default" />
              <StatCard
                title="업로드 완료 직원 수"
                value={`${adminSummary.uploadedEmployees}명`}
                icon={CheckCircle}
                variant="success"
              />
              <StatCard
                title="미업로드 직원 수"
                value={`${adminSummary.notUploadedEmployees}명`}
                icon={XCircle}
                variant="destructive"
              />
              <StatCard
                title="이상 항목 발생 직원 수"
                value={`${adminSummary.employeesWithWarning}명`}
                icon={AlertTriangle}
                variant="warning"
              />
              <StatCard title="전체 지각 횟수" value={`${adminSummary.totalLateCount}회`} icon={Clock} variant="warning" />
              <StatCard
                title="전체 9시간 미만 횟수"
                value={`${adminSummary.totalUnder9hCount}회`}
                icon={AlertTriangle}
                variant="destructive"
              />
              <StatCard
                title="전체 추가근무 시간"
                value={formatMinutesToKorean(adminSummary.totalOvertimeMinutes)}
                icon={TrendingUp}
                variant="default"
                emphasizeBlue={adminSummary.totalOvertimeMinutes >= 59}
              />
              <StatCard
                title="특근 발생 일수"
                value={`${adminSummary.specialWorkDays}일`}
                icon={CalendarCheck2}
                variant="destructive"
              />
            </>
          ) : (
            <>
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
            </>
          )}
          </div>
          {isAdminUser ? (
            <Card className="w-full shrink-0 border-slate-200 bg-white shadow-sm lg:w-[min(100%,22rem)] lg:max-w-[min(100%,22rem)]">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <LayoutDashboard className="h-5 w-5 text-slate-600" aria-hidden />
                  <CardTitle className="text-lg font-bold text-slate-900">관리자 확인 요약</CardTitle>
                </div>
                <p className="text-muted-foreground text-sm font-normal">
                  {selectedYear}년 {selectedMonth}월 · 취합 월과 동일 기준
                </p>
              </CardHeader>
              <CardContent className="space-y-5 pt-0">
                <section>
                  <h3 className="text-sm font-bold text-slate-800">미업로드 직원</h3>
                  {adminNotUploadedCanonicalNames.length === 0 ? (
                    <p className="mt-2 text-sm font-semibold text-emerald-600">전원 업로드 완료</p>
                  ) : (
                    <ul
                      className={cn(
                        "mt-2 space-y-1 rounded-md border px-3 py-2 text-sm font-semibold",
                        "border-orange-200 bg-orange-50 text-orange-800",
                      )}
                    >
                      {adminNotUploadedCanonicalNames.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h3 className="text-sm font-bold text-slate-800">이상 항목 TOP</h3>
                  {adminTopAnomalyEmployees.length === 0 ? (
                    <p className="mt-2 text-sm font-semibold text-emerald-600">이상 항목 없음</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {adminTopAnomalyEmployees.map((e) => (
                        <li key={e.name}>
                          <span className="font-bold text-slate-900">{e.name}</span>{" "}
                          <span className="font-bold text-rose-600">{e.count}건</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h3 className="text-sm font-bold text-slate-800">우선 확인 필요</h3>
                  {adminPriorityCheck.items.length === 0 ? (
                    <p className="mt-2 text-sm font-semibold text-emerald-600">확인 필요 건 없음</p>
                  ) : (
                    <>
                      <ul className="mt-2 space-y-2 text-sm">
                        {adminPriorityCheck.items.map((row, idx) => (
                          <li
                            key={`${row.workDate}-${row.employeeName}-${row.kindLabel}-${idx}`}
                            className="rounded-md border border-amber-100 bg-amber-50/80 px-2.5 py-1.5"
                          >
                            <span className="font-bold text-slate-900">{row.employeeName}</span>
                            <span className="text-slate-600"> · </span>
                            <span className="font-semibold tabular-nums text-slate-800">{row.workDate}</span>
                            <span className="text-slate-600"> · </span>
                            <span className="font-bold text-orange-700">{row.kindLabel}</span>
                          </li>
                        ))}
                      </ul>
                      {adminPriorityCheck.restCount > 0 ? (
                        <p className="mt-2 text-xs font-semibold text-slate-600">
                          외 {adminPriorityCheck.restCount}건
                        </p>
                      ) : null}
                    </>
                  )}
                </section>
              </CardContent>
            </Card>
          ) : (
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
          )}
        </div>

        {/* 근태 테이블 섹션 */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <CardTitle className="shrink-0 text-lg">근태 현황</CardTitle>
                <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-slate-600"
                    onClick={() => navigateSelectedMonth(-1)}
                    aria-label="취합 이전월"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[120px] text-center text-sm font-medium text-slate-700 tabular-nums sm:min-w-[140px] sm:text-base">
                    {selectedYear}년 {selectedMonth}월
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-slate-600"
                    onClick={() => navigateSelectedMonth(1)}
                    aria-label="취합 다음월"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                {isAdminUser && (
                  <div className="flex items-center gap-2">
                    <select
                      value={tempSelectedEmployeeName}
                      onChange={(event) => setTempSelectedEmployeeName(event.target.value)}
                      className="h-9 min-w-[140px] rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                      aria-label="직원 선택"
                    >
                      {ADMIN_EMPLOYEE_FILTER_OPTIONS.map((employeeName) => (
                        <option key={employeeName} value={employeeName}>
                          {employeeName}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 px-4 text-sm"
                      onClick={() => setSelectedEmployeeName(tempSelectedEmployeeName)}
                    >
                      조회
                    </Button>
                  </div>
                )}
              </div>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
            </div>
          </CardHeader>
          {finalExcelMessage && (
            <div className="px-6 pb-3">
              <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
                {finalExcelMessage}
              </p>
            </div>
          )}
          <CardContent className="p-0">
            <AttendanceTable
              data={attendanceData}
              isLoading={isAttendanceLoading}
              emptyMessage={attendanceEmptyMessage}
              showEmployeeColumn={isAdminUser}
              showWarningColumns={isAdminUser}
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
                    {isAdminUser && <TableHead>직원명</TableHead>}
                    <TableHead>날짜</TableHead>
                    <TableHead>유형</TableHead>
                    {isAdminUser && <TableHead>출근 원본</TableHead>}
                    {isAdminUser && <TableHead>퇴근 원본</TableHead>}
                    <TableHead>내용</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isWarningsLoading ? (
                    <TableRow>
                      <TableCell colSpan={isAdminUser ? 6 : 3} className="py-8 text-center text-slate-500">
                        로딩 중...
                      </TableCell>
                    </TableRow>
                  ) : warningPanelRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isAdminUser ? 6 : 3} className="py-8 text-center text-slate-500">
                        확인 필요 항목이 없습니다
                      </TableCell>
                    </TableRow>
                  ) : (
                    warningPanelRows.map((warning, index) => (
                      <TableRow
                        key={`${warning.userId}-${warning.workDate}-${warning.warningType}-${warning.message}-${index}`}
                      >
                        {isAdminUser && <TableCell className="font-semibold text-slate-900">{warning.employeeName || "-"}</TableCell>}
                        <TableCell className={cn("tabular-nums tracking-tight", getDateTextClassName(warning.workDate))}>
                          {warning.workDate}
                        </TableCell>
                        <TableCell>{warning.warningType}</TableCell>
                        {isAdminUser && <TableCell>{warning.checkInOriginal}</TableCell>}
                        {isAdminUser && <TableCell>{warning.checkOutOriginal}</TableCell>}
                        <TableCell>{warning.compactMessage}</TableCell>
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
