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

  useEffect(() => {
    let isMounted = true

    const checkSession = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error("[dashboard] session check error:", error)
      }

      if (!data.session) {
        if (isMounted) {
          setIsCheckingSession(true)
        }
        router.replace("/login")
        return
      }

      if (isMounted) {
        setIsCheckingSession(false)
      }
    }

    void checkSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
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
  }, [router])

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center text-base text-slate-600">
        로그인 세션 확인 중...
      </div>
    )
  }

  return <>{children}</>
}
