"use client"

import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const collectData = [
  { name: "홍길동", department: "개발팀", uploaded: "완료", updatedAt: "2026-04-22 09:12" },
  { name: "김철수", department: "디자인팀", uploaded: "완료", updatedAt: "2026-04-22 09:26" },
  { name: "이영희", department: "기획팀", uploaded: "대기", updatedAt: "-" },
]

export default function AdminCollectPage() {
  return (
    <DashboardLayout isAdmin userName="관리자">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">관리자 취합</h1>
          <p className="mt-1 text-slate-500">직원별 업로드 상태를 취합하고 확인합니다.</p>
        </div>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">업로드 취합 현황</CardTitle>
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
                {collectData.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.department}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          row.uploaded === "완료"
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                            : "bg-amber-100 text-amber-700 hover:bg-amber-100"
                        }
                      >
                        {row.uploaded}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.updatedAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
