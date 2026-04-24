"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getDateTextClassName } from "@/lib/attendance/calendar-display"
import { ChevronLeft, ChevronRight } from "lucide-react"

const WEEKDAY_LABELS_MON_FIRST = ["월", "화", "수", "목", "금", "토", "일"] as const

const pad2 = (n: number) => String(n).padStart(2, "0")

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function isWeekendColumn(colIndex: number): boolean {
  return colIndex === 5 || colIndex === 6
}

export type AttendanceMiniCalendarProps = {
  year: number
  month: number
  onNavigatePrev: () => void
  onNavigateNext: () => void
  /** attendance_records에만 있는 날짜 (DB 기준) */
  attendanceDates: ReadonlySet<string>
  /** warnings(병합·파생 포함) work_date — 표시 우선 */
  warningDates: ReadonlySet<string>
  /** 잔업 59분 이상 */
  highOvertimeDates?: ReadonlySet<string>
  className?: string
}

export function AttendanceMiniCalendar({
  year,
  month,
  onNavigatePrev,
  onNavigateNext,
  attendanceDates,
  warningDates,
  highOvertimeDates,
  className,
}: AttendanceMiniCalendarProps) {
  const n = new Date()
  const todayIso = toIsoDate(n.getFullYear(), n.getMonth() + 1, n.getDate())
  const overtimeSet = highOvertimeDates ?? new Set<string>()

  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1)
    const lead = (first.getDay() + 6) % 7
    const daysInMonth = new Date(year, month, 0).getDate()
    const out: (number | null)[] = []
    for (let i = 0; i < lead; i += 1) out.push(null)
    for (let d = 1; d <= daysInMonth; d += 1) out.push(d)
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [year, month])

  const rows: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7))
  }

  return (
    <Card className={cn("border-slate-200 bg-white shadow-sm", className)}>
      <CardHeader className="space-y-2 pb-2 pt-4">
        <div className="flex items-center justify-between gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-slate-600 hover:bg-slate-100"
            onClick={onNavigatePrev}
            aria-label="이전 달"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-0 flex-1 text-center text-sm font-semibold text-slate-900 sm:text-base">
            {year}년 {month}월 달력
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-slate-600 hover:bg-slate-100"
            onClick={onNavigateNext}
            aria-label="다음 달"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pb-4 pt-0">
        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium sm:text-xs">
          {WEEKDAY_LABELS_MON_FIRST.map((label, colIdx) => (
            <div
              key={label}
              className={cn(
                "py-1",
                isWeekendColumn(colIdx) ? "font-bold text-red-500" : "text-slate-500",
              )}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid auto-rows-fr gap-0.5">
          {rows.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-0.5">
              {week.map((day, di) => {
                if (day === null) {
                  return <div key={`e-${wi}-${di}`} className="min-h-[2.25rem] rounded-md bg-transparent" />
                }
                const iso = toIsoDate(year, month, day)
                const hasWarning = warningDates.has(iso)
                const hasAttendance = attendanceDates.has(iso)
                const highOt = overtimeSet.has(iso)
                const isToday = iso === todayIso

                return (
                  <div
                    key={iso}
                    className={cn(
                      "relative flex min-h-[2.25rem] flex-col items-center justify-center rounded-md border border-transparent text-[11px] sm:text-xs",
                      hasWarning && "bg-red-50/90",
                      !hasWarning && hasAttendance && "bg-emerald-50/90",
                      !hasWarning && highOt && "ring-1 ring-blue-300/90",
                      isToday && "ring-2 ring-slate-400/70 ring-offset-1 ring-offset-white",
                    )}
                  >
                    <span className={cn("leading-none tabular-nums", getDateTextClassName(iso))}>{day}</span>
                    <div className="mt-0.5 flex h-2 items-center justify-center gap-0.5">
                      {hasWarning ? (
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title="이상 있음" />
                      ) : hasAttendance ? (
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                          title="근무 기록"
                        />
                      ) : null}
                      {!hasWarning && highOt ? (
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                          title="잔업 59분 이상"
                        />
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <p className="text-[10px] leading-snug text-slate-500 sm:text-xs">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
            이상
          </span>
          <span className="mx-2 text-slate-300">|</span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            정상 근무
          </span>
          <span className="mx-2 text-slate-300">|</span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
            잔업 59분+
          </span>
        </p>
      </CardContent>
    </Card>
  )
}
