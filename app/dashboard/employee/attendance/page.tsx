"use client"

import { useState } from "react"
import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { AttendanceTable, sampleAttendanceData } from "@/components/dashboard/attendance-table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function EmployeeAttendancePage() {
  const [selectedPeriod, setSelectedPeriod] = useState("week")

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">내 근태 조회</h1>
          <p className="mt-1 text-slate-500">기간별 근태 기록을 확인하세요.</p>
        </div>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">근태 기록</CardTitle>
            <Tabs value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <TabsList className="bg-slate-100">
                <TabsTrigger value="week">주별</TabsTrigger>
                <TabsTrigger value="month">월별</TabsTrigger>
                <TabsTrigger value="year">연도별</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-0">
            <AttendanceTable data={sampleAttendanceData} />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
