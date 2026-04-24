import type { SupabaseClient } from "@supabase/supabase-js"
import { getMonthIsoRange } from "@/lib/attendance/month-date-range"

export type AttendanceInsertRow = {
  user_id: string
  source_file_id: string
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
  source_file_id: string
  work_date: string
  warning_type: string
  warning_message: string
  year: number
  month: number
}

/** user_id + year/month 및 동일 달 work_date 범위로 이중 삭제(레거시 행 포함) */
export async function deleteAttendanceAndWarningsForMonth(
  supabase: SupabaseClient,
  userId: string,
  year: number,
  month: number,
): Promise<void> {
  const { monthStart, nextMonthStart } = getMonthIsoRange(year, month)

  const ops = [
    supabase.from("attendance_records").delete().eq("user_id", userId).eq("year", year).eq("month", month),
    supabase
      .from("attendance_records")
      .delete()
      .eq("user_id", userId)
      .gte("work_date", monthStart)
      .lt("work_date", nextMonthStart),
    supabase.from("warnings").delete().eq("user_id", userId).eq("year", year).eq("month", month),
    supabase
      .from("warnings")
      .delete()
      .eq("user_id", userId)
      .gte("work_date", monthStart)
      .lt("work_date", nextMonthStart),
  ]

  for (const q of ops) {
    const { error } = await q
    if (error) {
      throw new Error(error.message)
    }
  }
}

export function isReplaceAttendanceRpcMissing(error: { message?: string; code?: string }): boolean {
  const m = error.message ?? ""
  const c = error.code ?? ""
  return (
    c === "PGRST202" ||
    m.includes("Could not find the function") ||
    m.includes("replace_attendance_for_month") ||
    m.includes("schema cache")
  )
}

export async function insertAttendanceRecordsWithFallback(
  supabase: SupabaseClient,
  attendanceRows: AttendanceInsertRow[],
): Promise<void> {
  if (attendanceRows.length === 0) return

  const { error: attendanceInsertError } = await supabase.from("attendance_records").insert(attendanceRows)
  if (attendanceInsertError?.message.includes("'work_status' column")) {
    const fallbackRows = attendanceRows.map((row) => ({
      user_id: row.user_id,
      source_file_id: row.source_file_id,
      work_date: row.work_date,
      check_in: row.check_in,
      check_out: row.check_out,
      total_minutes: row.total_minutes,
      is_late: row.is_late,
      is_under_9h: row.is_under_9h,
      overtime_minutes: row.overtime_minutes,
      is_special_workday: row.is_special_workday,
      year: row.year,
      month: row.month,
    }))
    const { error: fallbackInsertError } = await supabase.from("attendance_records").insert(fallbackRows)
    if (fallbackInsertError) {
      throw new Error(fallbackInsertError.message)
    }
  } else if (attendanceInsertError) {
    throw new Error(attendanceInsertError.message)
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
      source_file_id: warning.source_file_id,
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
        source_file_id: warning.source_file_id,
        work_date: warning.work_date,
        type: warning.type,
        message: warning.warning_message,
        year: warning.year,
        month: warning.month,
      }))

      const { error: fallbackWithTypeError } = await supabase.from("warnings").insert(warningRowsWithTypeAndMessage)
      if (fallbackWithTypeError) {
        throw new Error(fallbackWithTypeError.message)
      }
    } else if (typeInsertError) {
      throw new Error(typeInsertError.message)
    }
  } else if (warningsInsertError?.message.includes("'warning_message' column")) {
    const warningRowsWithMessage = warningRowsWithWarningMessage.map((warning) => ({
      user_id: warning.user_id,
      source_file_id: warning.source_file_id,
      work_date: warning.work_date,
      warning_type: warning.warning_type,
      message: warning.warning_message,
      year: warning.year,
      month: warning.month,
    }))

    const { error: fallbackWarningsInsertError } = await supabase.from("warnings").insert(warningRowsWithMessage)
    if (fallbackWarningsInsertError) {
      throw new Error(fallbackWarningsInsertError.message)
    }
  } else if (warningsInsertError) {
    throw new Error(warningsInsertError.message)
  }
}
