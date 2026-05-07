"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Users,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase/client"

const CTST_TECH_EMPLOYEES = [
  "장영광",
  "심종하",
  "오민석",
  "권태준",
  "김정훈",
  "이민성",
  "김희수",
  "김선태",
  "이주남",
] as const

const ADMIN_DEFAULT_YEAR = 2026
const ADMIN_DEFAULT_MONTH = 4

type UploadStatus = "완료" | "미업로드"
type CollectRow = {
  name: string
  department: string
  uploaded: UploadStatus
  updatedAt: string
}

type ProfileRow = { id: string; name: string | null }
type AttendanceRow = { user_id: string; work_date: string; created_at: string | null }

const formatDateTime = (isoText: string | null): string => {
  if (!isoText) return "미업로드"
  const d = new Date(isoText)
  if (Number.isNaN(d.getTime())) return "미업로드"
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${y}-${m}-${day} ${hh}:${mm}`
}

export default function AdminCollectPage() {
  const [selectedYear, setSelectedYear] = useState<number>(ADMIN_DEFAULT_YEAR)
  const [selectedMonth, setSelectedMonth] = useState<number>(ADMIN_DEFAULT_MONTH)
  const [showOnlyNotUploaded, setShowOnlyNotUploaded] = useState(false)
  const [selectedEmployeeName, setSelectedEmployeeName] = useState<string | null>(null)
  const [rows, setRows] = useState<CollectRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadCollectRows = async () => {
      setIsLoading(true)

      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, name")
        .in("name", [...CTST_TECH_EMPLOYEES])

      if (profilesError) {
        console.error("[admin-collect] profiles query error:", profilesError.message)
        const fallbackRows = CTST_TECH_EMPLOYEES.map((name) => ({
          name,
          department: "3Camp 기술팀",
          uploaded: "미업로드" as UploadStatus,
          updatedAt: "미업로드",
        }))
        setRows(fallbackRows)
        setIsLoading(false)
        return
      }

      const matchedProfiles = (profilesData ?? []) as ProfileRow[]
      const profileIdsByName = new Map<string, string[]>()
      for (const profile of matchedProfiles) {
        const name = (profile.name ?? "").trim()
        if (!name) continue
        const ids = profileIdsByName.get(name) ?? []
        ids.push(profile.id)
        profileIdsByName.set(name, ids)
      }

      const allProfileIds = Array.from(new Set(Array.from(profileIdsByName.values()).flat()))
      const monthStart = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`
      const monthEnd =
        selectedMonth === 12
          ? `${selectedYear + 1}-01-01`
          : `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-01`

      let attendanceRows: AttendanceRow[] = []
      if (allProfileIds.length > 0) {
        const { data: attendanceData, error: attendanceError } = await supabase
          .from("attendance_records")
          .select("user_id, work_date, created_at")
          .in("user_id", allProfileIds)
          .gte("work_date", monthStart)
          .lt("work_date", monthEnd)

        if (attendanceError) {
          console.error("[admin-collect] attendance query error:", attendanceError.message)
        } else {
          attendanceRows = (attendanceData ?? []) as AttendanceRow[]
        }
      }

      const attendanceByUserId = new Map<string, AttendanceRow[]>()
      for (const row of attendanceRows) {
        const list = attendanceByUserId.get(row.user_id) ?? []
        list.push(row)
        attendanceByUserId.set(row.user_id, list)
      }

      const nextRows: CollectRow[] = CTST_TECH_EMPLOYEES.map((name) => {
        const ids = profileIdsByName.get(name) ?? []
        const rowsForEmployee = ids.flatMap((id) => attendanceByUserId.get(id) ?? [])
        if (rowsForEmployee.length === 0) {
          return {
            name,
            department: "3Camp 기술팀",
            uploaded: "미업로드",
            updatedAt: "미업로드",
          }
        }
        const latestCreatedAt = rowsForEmployee
          .map((row) => row.created_at)
          .filter((value): value is string => Boolean(value))
          .sort((a, b) => b.localeCompare(a))[0] ?? null

        return {
          name,
          department: "3Camp 기술팀",
          uploaded: "완료",
          updatedAt: formatDateTime(latestCreatedAt),
        }
      })

      setRows(nextRows)
      setIsLoading(false)
    }

    void loadCollectRows()
  }, [selectedYear, selectedMonth])

  const summary = useMemo(() => {
    const total = CTST_TECH_EMPLOYEES.length
    const completed = rows.filter((row) => row.uploaded === "완료").length
    const notUploaded = total - completed
    const warningCount = notUploaded
    return { total, completed, notUploaded, warningCount }
  }, [rows])

  const sortedRows = rows

  const visibleRows = useMemo(() => {
    let data = sortedRows
    if (showOnlyNotUploaded) {
      data = data.filter((row) => row.uploaded === "미업로드")
    }
    if (selectedEmployeeName) {
      data = data.filter((row) => row.name === selectedEmployeeName)
    }
    return data
  }, [showOnlyNotUploaded, selectedEmployeeName, sortedRows])

  const hasNotUploaded = summary.notUploaded > 0
  const navigateMonth = (dir: -1 | 1) => {
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
  }

  return (
    <DashboardLayout isAdmin userName="관리자">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">관리자 취합</h1>
            <p className="mt-1 text-slate-500">직원별 업로드 상태를 취합하고 확인합니다.</p>
            <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-600"
                onClick={() => navigateMonth(-1)}
                aria-label="이전월"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[120px] text-center text-sm font-medium text-slate-700">
                {selectedYear}년 {selectedMonth}월
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-600"
                onClick={() => navigateMonth(1)}
                aria-label="다음월"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Button asChild className="h-10 rounded-lg bg-rose-500 px-5 font-bold text-white shadow-sm hover:bg-rose-600">
            <Link href="/dashboard/employee">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              최종 취합 엑셀 생성
            </Link>
          </Button>
        </div>

        {hasNotUploaded && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            <AlertTriangle className="h-4 w-4" />
            아직 업로드하지 않은 직원이 있습니다
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-slate-500">전체 직원 수</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{summary.total}명</p>
              </div>
              <Users className="h-5 w-5 text-slate-500" />
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-slate-500">업로드 완료 인원</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{summary.completed}명</p>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-slate-500">미업로드 인원</p>
                <p className="mt-1 text-2xl font-bold text-red-600">{summary.notUploaded}명</p>
              </div>
              <XCircle className="h-5 w-5 text-red-600" />
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-slate-500">경고 건수</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">{summary.warningCount}건</p>
              </div>
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg">업로드 취합 현황</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={showOnlyNotUploaded ? "default" : "outline"}
                  className={cn("h-9", showOnlyNotUploaded && "bg-red-600 text-white hover:bg-red-700")}
                  onClick={() => {
                    setShowOnlyNotUploaded(true)
                    setSelectedEmployeeName(null)
                  }}
                >
                  미업로드 직원만 보기
                </Button>
                <Button
                  type="button"
                  variant={!showOnlyNotUploaded ? "default" : "outline"}
                  className={cn("h-9", !showOnlyNotUploaded && "bg-slate-700 text-white hover:bg-slate-800")}
                  onClick={() => {
                    setShowOnlyNotUploaded(false)
                    setSelectedEmployeeName(null)
                  }}
                >
                  전체 보기
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>부서</TableHead>
                  <TableHead>업로드 상태</TableHead>
                  <TableHead>최근 반영 시간</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                      로딩 중...
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row) => (
                  <TableRow
                    key={row.name}
                    className={cn(
                      "transition-colors hover:bg-slate-50",
                      row.uploaded === "미업로드"
                        ? "bg-red-50/70 hover:bg-red-50"
                        : "bg-emerald-50/40 hover:bg-emerald-50/60",
                    )}
                  >
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="text-slate-800 hover:text-blue-600 hover:underline"
                        onClick={() => setSelectedEmployeeName((prev) => (prev === row.name ? null : row.name))}
                      >
                        {row.name}
                      </button>
                    </TableCell>
                    <TableCell>{row.department}</TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "font-bold",
                          row.uploaded === "완료"
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : "bg-red-100 text-red-700 hover:bg-red-100",
                        )}
                      >
                        {row.uploaded}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.updatedAt || "미업로드"}</TableCell>
                  </TableRow>
                )))}
                {!isLoading && visibleRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                      표시할 직원이 없습니다
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
