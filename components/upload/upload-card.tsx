"use client"

import { useState, useCallback, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, FileSpreadsheet, CheckCircle, X } from "lucide-react"
import { cn } from "@/lib/utils"
import * as XLSX from "xlsx"
import { supabase } from "@/lib/supabase/client"
import {
  getAttendanceYearMonthFromWorkbook,
  parseAttendanceWorkbook,
} from "@/lib/attendance/parse-attendance-excel"
import {
  deleteAttendanceAndWarningsForMonth,
  insertAttendanceRecordsWithFallback,
  insertWarningRowsWithFallback,
  isReplaceAttendanceRpcMissing,
  type AttendanceInsertRow,
  type WarningInsertRow,
} from "@/lib/attendance/supabase-attendance-upload"

interface UploadCardProps {
  onUpload?: (file: File) => void
}

export function UploadCard({ onUpload }: UploadCardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [successMessage, setSuccessMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  /** 이중 클릭·Strict Mode 등으로 handleUpload 가 겹쳐 insert 가 두 번 나가지 않도록 */
  const uploadInProgressRef = useRef(false)

  const isExcelFile = (file: File) => {
    const lowerName = file.name.toLowerCase()
    return lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")
  }

  const resetMessages = () => {
    setSuccessMessage("")
    setErrorMessage("")
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return

    resetMessages()
    if (!isExcelFile(file)) {
      setErrorMessage(".xls, .xlsx 파일만 업로드할 수 있습니다.")
      return
    }

    setUploadedFile(file)
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    resetMessages()
    if (!isExcelFile(file)) {
      setErrorMessage(".xls, .xlsx 파일만 업로드할 수 있습니다.")
      return
    }

    setUploadedFile(file)
  }, [])

  const handleUpload = async () => {
    if (!uploadedFile) return
    if (uploadInProgressRef.current) return

    uploadInProgressRef.current = true
    resetMessages()
    setIsUploading(true)

    try {
      const buffer = await uploadedFile.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: "array" })
      const { year, month } = getAttendanceYearMonthFromWorkbook(workbook)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user?.id) {
        throw new Error("로그인 사용자 정보를 찾을 수 없습니다.")
      }

      const parsed = parseAttendanceWorkbook(workbook)

      const { data: existingUploadedRows, error: existingFilesSelectError } = await supabase
        .from("uploaded_files")
        .select("file_path")
        .eq("user_id", user.id)
        .eq("year", year)
        .eq("month", month)

      if (existingFilesSelectError) {
        throw new Error(existingFilesSelectError.message)
      }

      const { error: deleteUploadedFilesMetaError } = await supabase
        .from("uploaded_files")
        .delete()
        .eq("user_id", user.id)
        .eq("year", year)
        .eq("month", month)

      if (deleteUploadedFilesMetaError) {
        throw new Error(deleteUploadedFilesMetaError.message)
      }

      const pathsToRemove = (existingUploadedRows ?? [])
        .map((row) => row.file_path)
        .filter((p): p is string => typeof p === "string" && p.length > 0)

      if (pathsToRemove.length > 0) {
        const { error: storageRemoveError } = await supabase.storage.from("attendance-files").remove(pathsToRemove)
        if (storageRemoveError) {
          throw new Error(storageRemoveError.message)
        }
      }

      const safeFileName = uploadedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")
      const filePath = `${user.id}/${year}/${String(month).padStart(2, "0")}/${Date.now()}-${safeFileName}`

      const { error: uploadError } = await supabase.storage
        .from("attendance-files")
        .upload(filePath, uploadedFile, { upsert: false })

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      const { data: uploadedFileRow, error: insertError } = await supabase
        .from("uploaded_files")
        .insert({
          user_id: user.id,
          file_name: uploadedFile.name,
          file_path: filePath,
          year,
          month,
        })
        .select("id")
        .single()

      if (insertError) {
        throw new Error(insertError.message)
      }

      const sourceFileId = uploadedFileRow?.id
      if (!sourceFileId) {
        throw new Error("업로드 파일 식별자를 가져오지 못했습니다.")
      }

      const attendanceRowsDedup = new Map<string, AttendanceInsertRow>()
      for (const record of parsed.records) {
        attendanceRowsDedup.set(record.workDate, {
          user_id: user.id,
          source_file_id: sourceFileId,
          work_date: record.workDate,
          check_in: record.checkInTime,
          check_out: record.checkOutTime,
          total_minutes: record.workMinutes,
          is_late: record.isLate,
          is_under_9h: record.isUnder9h,
          overtime_minutes: record.overtimeMinutes,
          is_special_workday: record.isSpecialWorkday,
          work_status: record.attendanceStatus,
          year,
          month,
        })
      }
      const attendanceRows = Array.from(attendanceRowsDedup.values())

      const warningRowsDedup = new Map<string, WarningInsertRow>()
      for (const warning of parsed.warnings) {
        const warningMessage = `${warning.warningMessage} (출근 원본: ${warning.checkInRawValue ?? "-"}, 퇴근 원본: ${warning.checkOutRawValue ?? "-"})`
        const warningKey = `${user.id}|${warning.workDate}|${warning.warningType}|${warningMessage}`
        warningRowsDedup.set(warningKey, {
          user_id: user.id,
          source_file_id: sourceFileId,
          work_date: warning.workDate,
          warning_type: warning.warningType,
          warning_message: warningMessage,
          year,
          month,
        })
      }
      const warningRowsWithWarningMessage = Array.from(warningRowsDedup.values())

      const pAttendance = attendanceRows.map((row) => ({
        work_date: row.work_date,
        check_in: row.check_in,
        check_out: row.check_out,
        total_minutes: row.total_minutes,
        is_late: row.is_late,
        is_under_9h: row.is_under_9h,
        overtime_minutes: row.overtime_minutes,
        is_special_workday: row.is_special_workday,
        work_status: row.work_status,
      }))

      const pWarnings = warningRowsWithWarningMessage.map((w) => ({
        work_date: w.work_date,
        warning_type: w.warning_type,
        warning_message: w.warning_message,
      }))

      const { error: rpcError } = await supabase.rpc("replace_attendance_for_month", {
        p_user_id: user.id,
        p_year: year,
        p_month: month,
        p_source_file_id: sourceFileId,
        p_attendance: pAttendance,
        p_warnings: pWarnings,
      })

      if (rpcError) {
        if (!isReplaceAttendanceRpcMissing(rpcError)) {
          throw new Error(rpcError.message)
        }
        await deleteAttendanceAndWarningsForMonth(supabase, user.id, year, month)
        await insertAttendanceRecordsWithFallback(supabase, attendanceRows)
        await insertWarningRowsWithFallback(supabase, warningRowsWithWarningMessage)
      }

      onUpload?.(uploadedFile)
      setSuccessMessage(`${year}년 ${month}월 데이터가 새 파일로 교체되었습니다`)
      setUploadedFile(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : "파일 업로드 중 오류가 발생했습니다."
      setErrorMessage(message)
    } finally {
      uploadInProgressRef.current = false
      setIsUploading(false)
    }
  }

  const handleRemoveFile = () => {
    setUploadedFile(null)
    resetMessages()
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">엑셀 파일 업로드</CardTitle>
      </CardHeader>
      <CardContent>
        {successMessage && (
          <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            {successMessage}
          </p>
        )}
        {errorMessage && (
          <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {errorMessage}
          </p>
        )}

        {!uploadedFile ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            )}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">파일을 드래그하거나 클릭하여 업로드</p>
                <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls 파일만 지원됩니다</p>
              </div>
              <label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileSelect}
                  disabled={isUploading}
                  className="hidden"
                />
                <Button variant="outline" size="sm" asChild>
                  <span className="cursor-pointer">파일 선택</span>
                </Button>
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-foreground">{uploadedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(uploadedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRemoveFile}
                className="h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <Button onClick={handleUpload} disabled={isUploading} className="w-full">
              {isUploading ? (
                <>업로드 중...</>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  업로드
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
