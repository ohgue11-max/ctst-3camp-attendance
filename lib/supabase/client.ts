import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "")
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase 환경 변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)를 확인해 주세요.")
}

if (!supabaseUrl.startsWith("https://")) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL 값이 올바르지 않습니다. https:// 로 시작해야 합니다.")
}

declare global {
  // eslint-disable-next-line no-var
  var __supabaseClient__: SupabaseClient | undefined
}

export const supabase =
  globalThis.__supabaseClient__ ??
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  })

if (typeof window !== "undefined") {
  globalThis.__supabaseClient__ = supabase
}
