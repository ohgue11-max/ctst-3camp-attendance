"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { DashboardUserProvider } from "@/components/layout/dashboard-user-context"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase/client"

type UserRole = "admin" | "employee"

interface DashboardLayoutProps {
  children: React.ReactNode
  isAdmin?: boolean
  userName?: string
}

export function DashboardLayout({
  children,
  isAdmin = false,
  userName = "",
}: DashboardLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [currentUserName, setCurrentUserName] = useState<string>(userName)
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>(isAdmin ? "admin" : "employee")
  const [isProfileLoading, setIsProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const loadCurrentUserProfile = async () => {
      setIsProfileLoading(true)
      setProfileError(null)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        console.error("[dashboard-layout] getUser error:", userError)
        if (isMounted) {
          setProfileError("사용자 정보를 불러올 수 없습니다")
          setIsProfileLoading(false)
        }
        return
      }

      if (!user?.id) {
        console.error("[dashboard-layout] no authenticated user found")
        if (isMounted) {
          setProfileError("사용자 정보를 불러올 수 없습니다")
          setIsProfileLoading(false)
        }
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("name, role")
        .eq("id", user.id)
        .maybeSingle()

      if (profileError) {
        console.error("[dashboard-layout] profiles fetch error:", profileError)
        if (isMounted) {
          setProfileError("사용자 정보를 불러올 수 없습니다")
          setIsProfileLoading(false)
        }
        return
      }

      if (!isMounted) {
        return
      }

      if (!profile) {
        console.error("[dashboard-layout] profile row not found for user:", user.id)
        setProfileError("사용자 정보를 불러올 수 없습니다")
        setIsProfileLoading(false)
        return
      }

      if (profile.role === "admin" || profile.role === "employee") {
        setCurrentUserRole(profile.role)
        setCurrentUserName(profile.name?.trim() || (profile.role === "admin" ? "관리자" : "직원"))
      } else {
        console.error("[dashboard-layout] invalid role value:", profile.role)
        setProfileError("사용자 정보를 불러올 수 없습니다")
        setIsProfileLoading(false)
        return
      }

      setIsProfileLoading(false)
    }

    void loadCurrentUserProfile()

    return () => {
      isMounted = false
    }
  }, [])

  if (isProfileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#e9edf1] text-base text-slate-600">
        로딩 중...
      </div>
    )
  }

  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#e9edf1] px-4">
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-base font-medium text-red-700">
          사용자 정보를 불러올 수 없습니다
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-[#e9edf1]">
      <div className="hidden lg:block">
        <Sidebar
          isAdmin={currentUserRole === "admin"}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 lg:hidden transition-transform duration-300",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar isAdmin={currentUserRole === "admin"} onToggle={() => setMobileMenuOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          userName={currentUserName}
          userRole={currentUserRole}
          onMenuClick={() => setMobileMenuOpen(true)}
        />
        <DashboardUserProvider value={{ displayName: currentUserName }}>
          <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
        </DashboardUserProvider>
      </div>
    </div>
  )
}
