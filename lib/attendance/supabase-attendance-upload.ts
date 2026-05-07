import type { SupabaseClient } from "@supabase/supabase-js"
import { getMonthIsoRange } from "@/lib/attendance/month-date-range"

export type AttendanceInsertRow = {
  user_id: string
  source_file_id?: string
  work_date: string
  check_in: string | null
  check_out: string | null
  total_minutes: number
  is_late: boolean
  is_under_9h: boolean
  overtime_minutes: number
  is_special_workday: boolean
  work_status: string
  year: number
  month: number
}

export type WarningInsertRow = {
  user_id: string
  source_file_id?: string
  work_date: string
  warning_type: string
  warning_message: string
  year: number
  month: number
}

/** user_id + (year·month 컬럼 일치 또는 해당 월 work_date) — 레거시 행 포함 삭제 */
function buildMonthOverlapOrFilter(year: number, month: number): string {
  const { monthStart, nextMonthStart } = getMonthIsoRange(year, month)
  return `and(year.eq.${year},month.eq.${month}),and(work_date.gte.${monthStart},work_date.lt.${nextMonthStart})`
}

export async function deleteAttendanceRecordsForMonth(
  supabase: SupabaseClient,
  userId: string,
  year: number,
  month: number,
): Promise<void> {
  const { error } = await supabase
    .from("attendance_records")
    .delete()
    .eq("user_id", userId)
    .or(buildMonthOverlapOrFilter(year, month))

  if (error) {
    console.warn("[attendance upload] delete attendance_records failed", error)
  }
}

export async function deleteWarningsForMonth(
  supabase: SupabaseClient,
  userId: string,
  year: number,
  month: number,
): Promise<void> {
  const { error } = await supabase
    .from("warnings")
    .delete()
    .eq("user_id", userId)
    .or(buildMonthOverlapOrFilter(year, month))

  if (error) {
    console.warn("[attendance upload] delete warnings failed", error)
  }
}

/**
 * 삭제 직후 잔여 행 참고용. 절대 throw 하지 않음.
 */
export async function assertMonthUploadDataCleared(
  supabase: SupabaseClient,
  userId: string,
  year: number,
  month: number,
): Promise<void> {
  const orFilter = buildMonthOverlapOrFilter(year, month)

  const [{ count: attendanceLeft, error: attErr }, { count: warningsLeft, error: warErr }, { count: filesLeft, error: fileErr }] =
    await Promise.all([
      supabase
        .from("attendance_records")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .or(orFilter),
      supabase
        .from("warnings")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .or(orFilter),
      supabase
        .from("uploaded_files")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("year", year)
        .eq("month", month),
    ])

  if (attErr || warErr || fileErr) {
    console.warn("[attendance upload] post-delete count query failed", {
      attErr,
      warErr,
      fileErr,
      userId,
      year,
      month,
    })
    return
  }

  if ((attendanceLeft ?? 0) > 0 || (warningsLeft ?? 0) > 0 || (filesLeft ?? 0) > 0) {
    console.warn("[attendance upload] rows remain after delete", {
      attendanceLeft,
      warningsLeft,
      filesLeft,
      userId,
      year,
      month,
    })
  }
}

/**
 * uploaded_files 메타 삭제 후 스토리지 정리용 file_path 목록. 실패 시 빈 배열.
 */
export async function deleteUploadedFileRecordsForMonth(
  supabase: SupabaseClient,
  userId: string,
  year: number,
  month: number,
): Promise<string[]> {
  const { data: existingUploadedRows, error: selectError } = await supabase
    .from("uploaded_files")
    .select("file_path")
    .eq("user_id", userId)
    .eq("year", year)
    .eq("month", month)

  if (selectError) {
    console.warn("[attendance upload] delete uploaded_files select failed", selectError)
    return []
  }

  const { error: deleteError } = await supabase
    .from("uploaded_files")
    .delete()
    .eq("user_id", userId)
    .eq("year", year)
    .eq("month", month)

  if (deleteError) {
    console.warn("[attendance upload] delete uploaded_files failed", deleteError)
    return []
  }

  return (existingUploadedRows ?? [])
    .map((row) => row.file_path)
    .filter((p): p is string => typeof p === "string" && p.length > 0)
}

export async function insertAttendanceRecordsWithFallback(
  supabase: SupabaseClient,
  attendanceRows: AttendanceInsertRow[],
): Promise<void> {
  if (attendanceRows.length === 0) return

  const { error: insertError } = await supabase.from("attendance_records").insert(attendanceRows)

  if (insertError?.message.includes("'work_status' column")) {
    const fallbackRows = attendanceRows.map((row) => {
      const { work_status: _w, ...rest } = row
      return rest
    })
    const { error: fallbackInsertError } = await supabase.from("attendance_records").insert(fallbackRows)
    if (fallbackInsertError) {
      throw new Error(fallbackInsertError.message)
    }
  } else if (insertError) {
    throw new Error(insertError.message)
  }
}

export async function insertWarningRowsWithFallback(
  supabase: SupabaseClient,
  warningRowsWithWarningMessage: WarningInsertRow[],
): Promise<void> {
  if (warningRowsWithWarningMessage.length === 0) return

  const { error: warningsInsertError } = await supabase.from("warnings").insert(warningRowsWithWarningMessage)

  if (warningsInsertError?.message.includes("'warning_type' column")) {
    const warningRowsWithType = warningRowsWithWarningMessage.map((warning) => ({
      user_id: warning.user_id,
      ...(warning.source_file_id ? { source_file_id: warning.source_file_id } : {}),
      work_date: warning.work_date,
      type: warning.warning_type,
      warning_message: warning.warning_message,
      year: warning.year,
      month: warning.month,
    }))

    const { error: typeInsertError } = await supabase.from("warnings").insert(warningRowsWithType)
    if (typeInsertError?.message.includes("'warning_message' column")) {
      const warningRowsWithTypeAndMessage = warningRowsWithType.map((warning) => ({
        user_id: warning.user_id,
        ...(warning.source_file_id ? { source_file_id: warning.source_file_id } : {}),
        work_date: warning.work_date,
        type: warning.type,
        message: warning.warning_message,
        year: warning.year,
        month: warning.month,
      }))

      const { error: fallbackWithTypeError } = await supabase.from("warnings").insert(warningRowsWithTypeAndMessage)
      if (fallbackWithTypeError) {
        console.warn("[attendance upload] warnings insert failed", fallbackWithTypeError)
        return
      }
    } else if (typeInsertError) {
      console.warn("[attendance upload] warnings insert failed", typeInsertError)
      return
    }
  } else if (warningsInsertError?.message.includes("'warning_message' column")) {
    const warningRowsWithMessage = warningRowsWithWarningMessage.map((warning) => ({
      user_id: warning.user_id,
      ...(warning.source_file_id ? { source_file_id: warning.source_file_id } : {}),
      work_date: warning.work_date,
      warning_type: warning.warning_type,
      message: warning.warning_message,
      year: warning.year,
      month: warning.month,
    }))

    const { error: fallbackWarningsInsertError } = await supabase.from("warnings").insert(warningRowsWithMessage)
    if (fallbackWarningsInsertError) {
      console.warn("[attendance upload] warnings insert failed", fallbackWarningsInsertError)
      return
    }
  } else if (warningsInsertError) {
    console.warn("[attendance upload] warnings insert failed", warningsInsertError)
    return
  }
}
