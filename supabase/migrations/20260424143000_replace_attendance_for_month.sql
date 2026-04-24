-- 트랜잭션 내에서 해당 월 근태·경고를 삭제 후 일괄 삽입합니다.
-- Supabase SQL Editor 또는 supabase db push 로 적용하세요.

CREATE OR REPLACE FUNCTION public.replace_attendance_for_month(
  p_user_id uuid,
  p_year integer,
  p_month integer,
  p_source_file_id uuid,
  p_attendance jsonb,
  p_warnings jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    (hashtext(p_user_id::text) % 2147483647)::integer,
    (hashtext(coalesce(p_year::text, '') || '/' || coalesce(p_month::text, '')) % 2147483647)::integer
  );

  DELETE FROM public.attendance_records
  WHERE user_id = p_user_id
    AND (
      (year = p_year AND month = p_month)
      OR (
        work_date >= make_date(p_year, p_month, 1)
        AND work_date < (make_date(p_year, p_month, 1) + INTERVAL '1 month')
      )
    );

  DELETE FROM public.warnings
  WHERE user_id = p_user_id
    AND (
      (year = p_year AND month = p_month)
      OR (
        work_date >= make_date(p_year, p_month, 1)
        AND work_date < (make_date(p_year, p_month, 1) + INTERVAL '1 month')
      )
    );

  IF p_attendance IS NOT NULL AND jsonb_typeof(p_attendance) = 'array' AND jsonb_array_length(p_attendance) > 0 THEN
    INSERT INTO public.attendance_records (
      user_id,
      source_file_id,
      work_date,
      check_in,
      check_out,
      total_minutes,
      is_late,
      is_under_9h,
      overtime_minutes,
      is_special_workday,
      work_status,
      year,
      month
    )
    SELECT
      p_user_id,
      p_source_file_id,
      (e->>'work_date')::date,
      NULLIF(e->>'check_in', ''),
      NULLIF(e->>'check_out', ''),
      COALESCE((e->>'total_minutes')::integer, 0),
      COALESCE((e->>'is_late')::boolean, false),
      COALESCE((e->>'is_under_9h')::boolean, false),
      COALESCE((e->>'overtime_minutes')::integer, 0),
      COALESCE((e->>'is_special_workday')::boolean, false),
      NULLIF(e->>'work_status', ''),
      p_year,
      p_month
    FROM jsonb_array_elements(p_attendance) AS e;
  END IF;

  IF p_warnings IS NOT NULL AND jsonb_typeof(p_warnings) = 'array' AND jsonb_array_length(p_warnings) > 0 THEN
    INSERT INTO public.warnings (
      user_id,
      source_file_id,
      work_date,
      warning_type,
      warning_message,
      year,
      month
    )
    SELECT
      p_user_id,
      p_source_file_id,
      (e->>'work_date')::date,
      NULLIF(e->>'warning_type', ''),
      COALESCE(e->>'warning_message', ''),
      p_year,
      p_month
    FROM jsonb_array_elements(p_warnings) AS e;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_attendance_for_month(uuid, integer, integer, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_attendance_for_month(uuid, integer, integer, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_attendance_for_month(uuid, integer, integer, uuid, jsonb, jsonb) TO service_role;
