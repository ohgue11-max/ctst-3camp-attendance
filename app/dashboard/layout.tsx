"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase/client"

type DashboardLayoutProps = {
  children: ReactNode
}

export default function DashboardAuthLayout({ children }: DashboardLayoutProps) {
  const router = useRouter()
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    let isMounted = true
    if (typeof window !== "undefined") {
      setIsLoggingOut(window.sessionStorage.getItem("ctst:isLoggingOut") === "1")
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    const checkSession = async () => {
      if (isLoggingOut) {
        if (isMounted) setIsCheckingSession(true)
        router.replace("/login")
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            window.location.href = "/login"
          }, 300)
        }
        return
      }
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          console.error("[dashboard] session check error:", error)
        }

        if (!data.session) {
          if (isMounted) {
            setIsCheckingSession(true)
          }
          router.replace("/login")
          if (typeof window !== "undefined") {
            window.setTimeout(() => {
              window.location.href = "/login"
            }, 300)
          }
          return
        }

        if (isMounted) {
          setIsCheckingSession(false)
        }
      } catch (error) {
        console.error("[dashboard] unexpected session error:", error)
        router.replace("/login")
      }
    }

    void checkSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (isLoggingOut) return
      if (!session) {
        if (isMounted) {
          setIsCheckingSession(true)
        }
        router.replace("/login")
        if (event === "SIGNED_OUT") {
          router.refresh()
        }
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [router, isLoggingOut])

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center text-base text-slate-600">
        로그인 세션 확인 중...
      </div>
    )
  }

  return <>{children}</>
}
