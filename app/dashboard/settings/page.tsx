"use client"

import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function DashboardSettingsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">설정</h1>
          <p className="mt-1 text-slate-500">알림 및 기본 표시 옵션을 관리하세요.</p>
        </div>

        <Card className="max-w-2xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">기본 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">알림 이메일</Label>
              <Input id="email" placeholder="name@ctst.co.kr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team">기본 조회 부서</Label>
              <Input id="team" placeholder="예: 개발팀" />
            </div>
            <Button className="bg-[#1185cc] hover:bg-[#0d73b0]">저장</Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
