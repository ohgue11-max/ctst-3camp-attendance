"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase/client"
import { Eye, EyeOff, KeyRound, LogIn, UserRound } from "lucide-react"

const EMAIL_DOMAIN = "ctst.local"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""

export default function LoginPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [userId, setUserId] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  useEffect(() => {
    let isMounted = true

    const checkSession = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error("[login] session check error:", error)
      }

      if (data.session) {
        router.replace("/dashboard")
        return
      }

      if (isMounted) {
        setIsCheckingSession(false)
      }
    }

    void checkSession()

    return () => {
      isMounted = false
    }
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage("")
    setIsLoading(true)

    try {
      if (!SUPABASE_URL.includes(".supabase.co")) {
        setErrorMessage("Supabase URL 설정이 올바르지 않습니다. .env.local 값을 확인해 주세요.")
        return
      }

      const normalizedId = userId.trim().toLowerCase()
      const email = `${normalizedId}@${EMAIL_DOMAIN}`

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      console.log("[login] signInWithPassword error:", error)

      if (error) {
        setErrorMessage(error.message)
        return
      }

      router.push("/dashboard")
    } catch (error) {
      console.error("[login] unexpected error:", error)
      setErrorMessage(error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center text-base text-slate-600">
        로그인 세션 확인 중...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#e9edf1] px-4 py-16">
      <div className="mx-auto w-full max-w-[620px]">
        <div className="text-center">
          <div className="inline-flex items-center justify-center rounded-sm bg-[#f2f5f8] px-4 py-2">
            <Image src="/ctst-logo.png" alt="CTST 로고" width={260} height={82} priority />
          </div>
          <p className="mt-4 text-[34px] font-semibold tracking-[-0.02em] text-slate-600">
            직원 출퇴근 기록을 한곳에서 관리합니다
          </p>
        </div>

        <Card className="mt-10 rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-300/40">
          <CardHeader className="px-8 pb-1 pt-8 text-center">
            <CardTitle className="text-[44px] font-extrabold tracking-[-0.02em] text-slate-900">
              출근부 시스템
            </CardTitle>
            <p className="mt-2 text-2xl font-medium text-slate-500">
              계정 ID와 비밀번호로 로그인하세요
            </p>
          </CardHeader>
          <CardContent className="px-8 pb-8 pt-6">
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="userId" className="text-[34px] font-semibold text-slate-900">
                  계정 ID
                </Label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="userId"
                    type="text"
                    placeholder="사원번호 또는 아이디"
                    value={userId}
                    onChange={(e) => {
                      setUserId(e.target.value)
                      setErrorMessage("")
                    }}
                    required
                    disabled={isLoading}
                    className="h-14 rounded-xl border-slate-300 bg-slate-100 pl-11 text-lg placeholder:text-slate-500 focus-visible:bg-white"
                  />
                </div>
                <p className="text-lg font-medium text-slate-500">
                  이메일이 아닌 사내 계정 ID만 입력합니다 (@ 없음)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[34px] font-semibold text-slate-900">
                  비밀번호
                </Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="비밀번호"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setErrorMessage("")
                    }}
                    required
                    disabled={isLoading}
                    className="h-14 rounded-xl border-slate-300 bg-slate-100 pl-11 pr-12 text-lg placeholder:text-slate-500 focus-visible:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {errorMessage && (
                <p role="alert" className="text-base font-medium text-red-600">
                  {errorMessage}
                </p>
              )}

              <Button
                type="submit"
                className="mt-2 h-14 w-full rounded-xl bg-[#1185cc] text-[34px] font-bold tracking-tight text-white hover:bg-[#0d73b0]"
                disabled={isLoading}
              >
                <LogIn className="mr-2 h-5 w-5" />
                {isLoading ? "로그인 중..." : "로그인"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
