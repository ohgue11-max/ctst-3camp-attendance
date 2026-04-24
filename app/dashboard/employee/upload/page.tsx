"use client"

import { DashboardLayout } from "@/components/layout/dashboard-layout"
import { UploadCard } from "@/components/upload/upload-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function EmployeeUploadPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">엑셀 업로드</h1>
          <p className="mt-1 text-slate-500">근태 데이터를 엑셀 파일로 업로드하세요.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <UploadCard
            onUpload={(file) => {
              console.log("Uploaded file:", file.name)
            }}
          />
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">업로드 가이드</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-slate-600">
                <li>1. 사내 표준 양식의 근태 파일을 준비하세요.</li>
                <li>2. 파일 형식은 .xlsx 또는 .xls만 업로드할 수 있습니다.</li>
                <li>3. 업로드 완료 후 관리자 취합 화면에서 확인됩니다.</li>
                <li>4. 오류 발생 시 설정 메뉴에서 문의처를 확인하세요.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
