"use client"

import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { StatCard } from "@/components/dashboard/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Users,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  FileSpreadsheet,
} from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"

// 샘플 직원 데이터
const employeeData = [
  {
    id: 1,
    name: "홍길동",
    department: "개발팀",
    uploadStatus: "완료",
    lastUpload: "2024-01-19",
    warnings: 0,
  },
  {
    id: 2,
    name: "김철수",
    department: "디자인팀",
    uploadStatus: "완료",
    lastUpload: "2024-01-18",
    warnings: 1,
  },
  {
    id: 3,
    name: "이영희",
    department: "기획팀",
    uploadStatus: "미완료",
    lastUpload: "-",
    warnings: 0,
  },
  {
    id: 4,
    name: "박민수",
    department: "개발팀",
    uploadStatus: "완료",
    lastUpload: "2024-01-19",
    warnings: 2,
  },
  {
    id: 5,
    name: "최지은",
    department: "마케팅팀",
    uploadStatus: "미완료",
    lastUpload: "-",
    warnings: 0,
  },
  {
    id: 6,
    name: "정우진",
    department: "개발팀",
    uploadStatus: "완료",
    lastUpload: "2024-01-17",
    warnings: 1,
  },
]

export default function AdminDashboardPage() {
  const totalEmployees = employeeData.length
  const uploadedCount = employeeData.filter(e => e.uploadStatus === "완료").length
  const notUploadedCount = totalEmployees - uploadedCount
  const totalWarnings = employeeData.reduce((acc, e) => acc + e.warnings, 0)

  return (
    <DashboardLayout isAdmin userName="관리자">
      <div className="space-y-6">
        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">관리자 대시보드</h1>
            <p className="text-muted-foreground mt-1">직원 근태 현황을 관리하세요.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/admin/collect">
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              전체 취합
              </Link>
            </Button>
            <Button>
              <Download className="w-4 h-4 mr-2" />
              엑셀 다운로드
            </Button>
          </div>
        </div>

        {/* 통계 카드들 */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="전체 직원 수"
            value={totalEmployees}
            icon={Users}
            description="등록된 직원"
            variant="default"
          />
          <StatCard
            title="업로드 완료"
            value={uploadedCount}
            icon={CheckCircle}
            description={`${((uploadedCount / totalEmployees) * 100).toFixed(0)}% 완료`}
            variant="success"
          />
          <StatCard
            title="미업로드"
            value={notUploadedCount}
            icon={XCircle}
            description="업로드 대기 중"
            variant="warning"
          />
          <StatCard
            title="경고 건수"
            value={totalWarnings}
            icon={AlertTriangle}
            description="이번 달 누적"
            variant="destructive"
          />
        </div>

        {/* 직원별 현황 테이블 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">직원별 현황</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead>부서</TableHead>
                    <TableHead>업로드 상태</TableHead>
                    <TableHead>최근 업로드</TableHead>
                    <TableHead>경고</TableHead>
                    <TableHead className="text-right">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeeData.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">{employee.name}</TableCell>
                      <TableCell>{employee.department}</TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "font-medium",
                            employee.uploadStatus === "완료"
                              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                              : "bg-amber-100 text-amber-700 hover:bg-amber-100"
                          )}
                        >
                          {employee.uploadStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>{employee.lastUpload}</TableCell>
                      <TableCell>
                        {employee.warnings > 0 ? (
                          <Badge variant="destructive" className="font-medium">
                            {employee.warnings}건
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm">
                          상세보기
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
