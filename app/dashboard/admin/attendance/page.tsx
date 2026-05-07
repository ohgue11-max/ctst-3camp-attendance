"use client"

import { useEffect, useMemo, useState } from "react"
import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"

type ViewMode = "month" | "year"

type AttendanceRow = {
  user_id: string
  work_date: string
  is_late: boolean | null
  is_under_9h: boolean | null
  is_special_workday: boolean | null
}

type WarningRow = {
  user_id: string
  work_date: string
  warning_type: string | null
  warning_message: string | null
}

const ADMIN_EMPLOYEES = ["장영광", "심종하", "오민석", "권태준", "김정훈", "이민성", "김희수", "김선태", "윤효준"] as const
const ALL_EMPLOYEES_LABEL = "전체 직원"

const normalizeName = (name: string) => name.trim().normalize("NFC")
const pad2 = (v: number) => String(v).padStart(2, "0")

function toMonthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${pad2(month)}-01`
  const end =
    month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`
  return { start, end }
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function dateOf(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export default function AdminAttendanceOverviewPage() {
  const today = new Date()
  const [viewMode, setViewMode] = useState<ViewMode>("month")
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1)
  const [selectedEmployeeName, setSelectedEmployeeName] = useState<string>(ALL_EMPLOYEES_LABEL)
  const [selectedDate, setSelectedDate] = useState<string>(dateOf(today.getFullYear(), today.getMonth() + 1, today.getDate()))
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([])
  const [warningRows, setWarningRows] = useState<WarningRow[]>([])
  const [nameByUserId, setNameByUserId] = useState<Map<string, string>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const isLoggingOut =
    typeof window !== "undefined" && window.sessionStorage.getItem("ctst:isLoggingOut") === "1"

  useEffect(() => {
    let isMounted = true
    const load = async () => {
      if (isLoggingOut) return
      setIsLoading(true)
      const { start, end } =
        viewMode === "year"
          ? { start: `${selectedYear}-01-01`, end: `${selectedYear + 1}-01-01` }
          : toMonthRange(selectedYear, selectedMonth)

      const { data: profiles, error: profileError } = await supabase.from("profiles").select("id, name, role")
      if (profileError || !profiles) {
        if (isMounted) setIsLoading(false)
        return
      }
      const employeeProfiles = profiles
        .map((p) => ({ id: String(p.id), name: normalizeName(String(p.name ?? "")), role: String(p.role ?? "") }))
        .filter((p) => p.role === "employee" && p.name !== "관리자" && ADMIN_EMPLOYEES.includes(p.name as (typeof ADMIN_EMPLOYEES)[number]))
      const map = new Map<string, string>(employeeProfiles.map((p) => [p.id, p.name]))

      let records: AttendanceRow[] = []
      if (viewMode === "month") {
        const ym = await supabase.from("attendance_records").select("*").eq("year", selectedYear).eq("month", selectedMonth)
        if (ym.error || (ym.data ?? []).length === 0) {
          const fallback = await supabase.from("attendance_records").select("*").gte("work_date", start).lt("work_date", end)
          records = ((fallback.data ?? []) as AttendanceRow[]).map((r) => ({ ...r, user_id: String(r.user_id) }))
        } else {
          records = ((ym.data ?? []) as AttendanceRow[]).map((r) => ({ ...r, user_id: String(r.user_id) }))
        }
      } else {
        const result = await supabase.from("attendance_records").select("*").gte("work_date", start).lt("work_date", end)
        records = ((result.data ?? []) as AttendanceRow[]).map((r) => ({ ...r, user_id: String(r.user_id) }))
      }

      const warningResult = await supabase.from("warnings").select("*").gte("work_date", start).lt("work_date", end)
      const warnings = ((warningResult.data ?? []) as WarningRow[]).map((w) => ({ ...w, user_id: String(w.user_id) }))

      const filteredRecords = records.filter((r) => map.has(r.user_id))
      const filteredWarnings = warnings.filter((w) => map.has(w.user_id))

      if (isMounted) {
        setNameByUserId(map)
        setAttendanceRows(filteredRecords)
        setWarningRows(filteredWarnings)
        setIsLoading(false)
      }
    }
    void load()
    return () => {
      isMounted = false
    }
  }, [selectedYear, selectedMonth, viewMode, isLoggingOut])

  const effectiveAttendance = useMemo(() => {
    if (selectedEmployeeName === ALL_EMPLOYEES_LABEL) return attendanceRows
    return attendanceRows.filter((r) => (nameByUserId.get(r.user_id) ?? "") === normalizeName(selectedEmployeeName))
  }, [attendanceRows, selectedEmployeeName, nameByUserId])

  const effectiveWarnings = useMemo(() => {
    if (selectedEmployeeName === ALL_EMPLOYEES_LABEL) return warningRows
    return warningRows.filter((w) => (nameByUserId.get(w.user_id) ?? "") === normalizeName(selectedEmployeeName))
  }, [warningRows, selectedEmployeeName, nameByUserId])

  const daySummaries = useMemo(() => {
    const map = new Map<string, {
      uploaded: Set<string>
      late: number
      under9: number
      warningCount: number
      special: Set<string>
    }>()
    const ensure = (d: string) => {
      if (!map.has(d)) map.set(d, { uploaded: new Set(), late: 0, under9: 0, warningCount: 0, special: new Set() })
      return map.get(d)!
    }
    for (const r of effectiveAttendance) {
      const s = ensure(r.work_date)
      s.uploaded.add(r.user_id)
      if (r.is_late) s.late += 1
      if (r.is_under_9h) s.under9 += 1
      if (r.is_special_workday) s.special.add(r.user_id)
    }
    for (const w of effectiveWarnings) {
      ensure(w.work_date).warningCount += 1
    }
    return map
  }, [effectiveAttendance, effectiveWarnings])

  const monthCards = useMemo(() => {
    const cards: Array<{ month: number; uploadRate: string; warning: number; late: number; under9: number; specialDays: number }> = []
    for (let m = 1; m <= 12; m += 1) {
      const { start, end } = toMonthRange(selectedYear, m)
      const monthRows = effectiveAttendance.filter((r) => r.work_date >= start && r.work_date < end)
      const monthWarnings = effectiveWarnings.filter((w) => w.work_date >= start && w.work_date < end)
      const uploaded = new Set(monthRows.map((r) => r.user_id)).size
      const totalBase = selectedEmployeeName === ALL_EMPLOYEES_LABEL ? ADMIN_EMPLOYEES.length : 1
      const late = monthRows.filter((r) => Boolean(r.is_late)).length
      const under9 = monthRows.filter((r) => Boolean(r.is_under_9h)).length
      const specialDays = new Set(monthRows.filter((r) => Boolean(r.is_special_workday)).map((r) => r.work_date)).size
      cards.push({
        month: m,
        uploadRate: `${uploaded}/${totalBase}명`,
        warning: monthWarnings.length,
        late,
        under9,
        specialDays,
      })
    }
    return cards
  }, [selectedYear, effectiveAttendance, effectiveWarnings, selectedEmployeeName])

  const selectedDateDetail = useMemo(() => {
    const rows = effectiveAttendance.filter((r) => r.work_date === selectedDate)
    const warnings = effectiveWarnings.filter((w) => w.work_date === selectedDate)
    const uploaded = Array.from(new Set(rows.map((r) => nameByUserId.get(r.user_id) ?? ""))).filter(Boolean)
    const baseNames = selectedEmployeeName === ALL_EMPLOYEES_LABEL ? [...ADMIN_EMPLOYEES] : [normalizeName(selectedEmployeeName)]
    const uploadedSet = new Set(uploaded)
    const notUploaded = baseNames.filter((n) => !uploadedSet.has(n))
    const late = Array.from(new Set(rows.filter((r) => r.is_late).map((r) => nameByUserId.get(r.user_id) ?? ""))).filter(Boolean)
    const under9 = Array.from(new Set(rows.filter((r) => r.is_under_9h).map((r) => nameByUserId.get(r.user_id) ?? ""))).filter(Boolean)
    const special = Array.from(new Set(rows.filter((r) => r.is_special_workday).map((r) => nameByUserId.get(r.user_id) ?? ""))).filter(Boolean)
    const warningList = warnings.map((w) => `${nameByUserId.get(w.user_id) ?? "-"}: ${w.warning_type ?? "-"} / ${w.warning_message ?? "-"}`)
    return { uploaded, notUploaded, late, under9, special, warningList }
  }, [effectiveAttendance, effectiveWarnings, selectedDate, selectedEmployeeName, nameByUserId])

  const movePeriod = (dir: -1 | 1) => {
    if (viewMode === "year") {
      setSelectedYear((y) => y + dir)
      return
    }
    let y = selectedYear
    let m = selectedMonth + dir
    if (m > 12) {
      m = 1
      y += 1
    }
    if (m < 1) {
      m = 12
      y -= 1
    }
    setSelectedYear(y)
    setSelectedMonth(m)
  }

  const todayIso = dateOf(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const monthDays = viewMode === "month" ? getDaysInMonth(selectedYear, selectedMonth) : 0
  const totalBase = selectedEmployeeName === ALL_EMPLOYEES_LABEL ? ADMIN_EMPLOYEES.length : 1

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">전체 근태 조회</h1>
            <p className="mt-1 text-slate-500">전체 직원 월별/연도별 근태를 확인하세요.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedEmployeeName}
              onChange={(e) => setSelectedEmployeeName(e.target.value)}
              className="h-9 min-w-[160px] rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              <option value={ALL_EMPLOYEES_LABEL}>{ALL_EMPLOYEES_LABEL}</option>
              {ADMIN_EMPLOYEES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-0.5">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => movePeriod(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[140px] text-center text-sm font-semibold text-slate-700">
                {viewMode === "month" ? `${selectedYear}년 ${selectedMonth}월` : `${selectedYear}년`}
              </span>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => movePeriod(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex overflow-hidden rounded-md border border-slate-200">
              <button
                className={cn("px-3 py-1.5 text-sm", viewMode === "month" ? "bg-slate-800 text-white" : "bg-white text-slate-600")}
                onClick={() => setViewMode("month")}
              >
                월별
              </button>
              <button
                className={cn("px-3 py-1.5 text-sm", viewMode === "year" ? "bg-slate-800 text-white" : "bg-white text-slate-600")}
                onClick={() => setViewMode("year")}
              >
                연도별
              </button>
            </div>
          </div>
        </div>

        {viewMode === "month" ? (
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">{selectedYear}년 {selectedMonth}월 달력</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="py-8 text-center text-slate-500">로딩 중...</p>
                ) : (
                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({ length: monthDays }, (_, i) => i + 1).map((day) => {
                      const iso = dateOf(selectedYear, selectedMonth, day)
                      const s = daySummaries.get(iso)
                      const uploaded = s?.uploaded.size ?? 0
                      const warning = s?.warningCount ?? 0
                      const special = s?.special.size ?? 0
                      const hasData = Boolean(s)
                      const hasMissing = uploaded < totalBase
                      const tone = !hasData
                        ? "bg-slate-100"
                        : warning > 0
                          ? "bg-red-50"
                          : hasMissing
                            ? "bg-amber-50"
                            : special > 0
                              ? "bg-blue-50"
                              : "bg-emerald-50"
                      return (
                        <button
                          key={iso}
                          onClick={() => setSelectedDate(iso)}
                          className={cn(
                            "min-h-[110px] rounded-md border p-2 text-left",
                            tone,
                            iso === todayIso && "border-2 border-slate-800",
                            iso === selectedDate && "border-2 border-blue-600",
                          )}
                        >
                          <p className="text-sm font-bold text-slate-900">{day}</p>
                          <p className="mt-1 text-xs text-slate-700">{uploaded}/{totalBase}명</p>
                          <p className="text-xs text-amber-700">지각 {s?.late ?? 0}</p>
                          <p className="text-xs text-rose-700">부족 {s?.under9 ?? 0}</p>
                          <p className="text-xs text-red-700">확인 {warning}</p>
                          <p className="text-xs text-blue-700">특근 {special}</p>
                        </button>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">날짜 상세 ({selectedDate})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><span className="font-semibold">업로드:</span> {selectedDateDetail.uploaded.join(", ") || "-"}</div>
                <div><span className="font-semibold">미업로드:</span> {selectedDateDetail.notUploaded.join(", ") || "-"}</div>
                <div><span className="font-semibold">지각:</span> {selectedDateDetail.late.join(", ") || "-"}</div>
                <div><span className="font-semibold">9시간 미만:</span> {selectedDateDetail.under9.join(", ") || "-"}</div>
                <div><span className="font-semibold">확인 필요:</span> {selectedDateDetail.warningList.join(" | ") || "-"}</div>
                <div><span className="font-semibold">특근:</span> {selectedDateDetail.special.join(", ") || "-"}</div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">{selectedYear}년 월별 요약</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {monthCards.map((m) => (
                  <button
                    key={m.month}
                    onClick={() => {
                      setSelectedMonth(m.month)
                      setViewMode("month")
                    }}
                    className="rounded-md border border-slate-200 bg-white p-3 text-left hover:bg-slate-50"
                  >
                    <p className="font-bold text-slate-900">{m.month}월</p>
                    <p className="mt-1 text-xs text-slate-600">업로드율 {m.uploadRate}</p>
                    <p className="text-xs text-red-700">확인 필요 {m.warning}</p>
                    <p className="text-xs text-amber-700">지각 {m.late}</p>
                    <p className="text-xs text-rose-700">9시간 미만 {m.under9}</p>
                    <p className="text-xs text-blue-700">특근 일수 {m.specialDays}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
