"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getDateTextClassName } from "@/lib/attendance/calendar-display"

export type AttendanceStatusBadgeLabel = "정상" | "이상 있음" | "9시간 미만"

export interface AttendanceRecord {
  date: string
  checkIn: string
  checkOut: string
  totalWorkTime: string
  isLate: boolean
  isUnder9h: boolean
  overtimeTime: string
  isSpecialWorkday: boolean
  /** DB·파생 규칙 등 근태 이상이면 true (행 강조·배지 색) */
  hasDataWarning: boolean
  /** 근태 상태 열 배지 문구 */
  statusBadgeLabel: AttendanceStatusBadgeLabel
  /** 잔업(overtime) 59분 이상이면 true — 잔업 열 강조 */
  highOvertimeDay?: boolean
}

interface AttendanceTableProps {
  data: AttendanceRecord[]
  isLoading?: boolean
  emptyMessage?: string
}

export function AttendanceTable({
  data,
  isLoading = false,
  emptyMessage = "근태 데이터가 없습니다",
}: AttendanceTableProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>날짜</TableHead>
            <TableHead>출근시간</TableHead>
            <TableHead>퇴근시간</TableHead>
            <TableHead>총 근무시간</TableHead>
            <TableHead>지각 여부</TableHead>
            <TableHead>9시간 미만 여부</TableHead>
            <TableHead>잔업 시간</TableHead>
            <TableHead>특근 여부</TableHead>
            <TableHead>근태 상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={9} className="py-8 text-center text-slate-500">
                로딩 중...
              </TableCell>
            </TableRow>
          ) : data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="py-8 text-center text-slate-500">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((record) => (
              <TableRow
                key={record.date}
                className={cn(record.hasDataWarning && "bg-red-50/90 hover:bg-red-50/90")}
              >
                <TableCell className={cn("tabular-nums tracking-tight", getDateTextClassName(record.date))}>
                  {record.date}
                </TableCell>
                <TableCell>{record.checkIn}</TableCell>
                <TableCell>{record.checkOut}</TableCell>
                <TableCell>{record.totalWorkTime}</TableCell>
                <TableCell>
                  <Badge
                    className={cn(
                      "font-medium",
                      record.isLate
                        ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                        : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                    )}
                  >
                    {record.isLate ? "예" : "아니오"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    className={cn(
                      "font-medium",
                      record.isUnder9h
                        ? "bg-red-100 text-red-700 hover:bg-red-100"
                        : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                    )}
                  >
                    {record.isUnder9h ? "예" : "아니오"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {record.highOvertimeDay ? (
                    <Badge className="border border-blue-200 bg-blue-50 font-semibold text-blue-700 hover:bg-blue-50">
                      {record.overtimeTime}
                    </Badge>
                  ) : (
                    record.overtimeTime
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    className={cn(
                      "font-medium",
                      record.isSpecialWorkday
                        ? "bg-red-100 text-red-700 hover:bg-red-100"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-100",
                    )}
                  >
                    {record.isSpecialWorkday ? "예" : "아니오"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    className={cn(
                      "font-medium",
                      record.hasDataWarning
                        ? "bg-red-100 text-red-800 hover:bg-red-100"
                        : "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
                    )}
                  >
                    {record.statusBadgeLabel}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

// 샘플 데이터
export const sampleAttendanceData: AttendanceRecord[] = [
  {
    date: "2024-01-15",
    checkIn: "08:55",
    checkOut: "18:30",
    totalWorkTime: "9시간 35분",
    overtimeTime: "35분",
    isLate: false,
    isUnder9h: false,
    isSpecialWorkday: false,
    hasDataWarning: false,
    statusBadgeLabel: "정상",
    highOvertimeDay: false,
  },
  {
    date: "2024-01-16",
    checkIn: "09:10",
    checkOut: "18:45",
    totalWorkTime: "9시간 35분",
    overtimeTime: "35분",
    isLate: true,
    isUnder9h: false,
    isSpecialWorkday: false,
    hasDataWarning: true,
    statusBadgeLabel: "이상 있음",
    highOvertimeDay: false,
  },
]
