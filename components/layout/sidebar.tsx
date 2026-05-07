"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Home,
  Clock,
  FileSpreadsheet,
  Settings,
  LogOut,
  ShieldCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase/client"

interface SidebarProps {
  isAdmin?: boolean
  collapsed?: boolean
  onToggle?: () => void
}

export function Sidebar({ isAdmin = false, collapsed = false, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const employeeNavItems = [
    { href: "/dashboard/employee", label: "대시보드", icon: LayoutDashboard },
    { href: "/dashboard/employee/attendance", label: "내 근태 조회", icon: Clock },
    { href: "/dashboard/employee/upload", label: "엑셀 업로드", icon: FileSpreadsheet },
    { href: "/dashboard/settings", label: "설정", icon: Settings },
  ]

  const adminNavItems = [
    { href: "/dashboard/admin", label: "근태 관리 센터", icon: Home },
    { href: "/dashboard/admin/attendance", label: "전체 근태 조회", icon: CalendarDays },
    { href: "/dashboard/admin/collect", label: "관리자 취합", icon: ShieldCheck },
    { href: "/dashboard/settings", label: "설정", icon: Settings },
  ]

  const navItems = isAdmin ? adminNavItems : employeeNavItems

  const clearAuthStorage = () => {
    if (typeof window === "undefined") return
    try {
      const localKeys = Object.keys(window.localStorage)
      for (const key of localKeys) {
        if (key.includes("auth") || key.includes("supabase") || key.startsWith("sb-")) {
          window.localStorage.removeItem(key)
        }
      }
      const sessionKeys = Object.keys(window.sessionStorage)
      for (const key of sessionKeys) {
        if (key.includes("auth") || key.includes("supabase") || key.startsWith("sb-")) {
          window.sessionStorage.removeItem(key)
        }
      }
    } catch (error) {
      console.error("[sidebar] clearAuthStorage error:", error)
    }
  }

  const handleSignOut = async () => {
    if (isLoggingOut) return

    try {
      setIsLoggingOut(true)
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("ctst:isLoggingOut", "1")
      }

      const { error } = await supabase.auth.signOut({ scope: "local" })
      if (error) {
        throw error
      }
      clearAuthStorage()

      router.replace("/login")
      router.refresh()
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          window.location.href = "/login"
        }, 300)
      }
    } catch (error) {
      console.error("logout error:", error)
      clearAuthStorage()
      if (typeof window !== "undefined") {
        window.location.href = "/login"
      }
      setIsLoggingOut(false)
    }
  }

  return (
    <aside
      className={cn(
        "h-screen bg-white border-r border-slate-200 flex flex-col transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200">
        {!collapsed && (
          <Link
            href={isAdmin ? "/dashboard/admin" : "/dashboard/employee"}
            className="flex items-center"
          >
            <span className="text-[23px] font-bold">
              <span className="text-[#1185cc]">CTST</span>
              <span className="text-slate-900"> 출근부</span>
            </span>
          </Link>
        )}
        {collapsed && (
          <div className="mx-auto text-sm font-bold text-[#1185cc]">
            CT
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className={cn("h-8 w-8", collapsed && "mx-auto mt-2")}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-[#e8f2fb] text-[#1185cc]"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isLoggingOut}
          className={cn(
            "mt-3 flex w-full items-center gap-3 rounded-lg bg-red-100 px-4 py-3 text-base font-semibold text-red-700 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60",
            collapsed && "justify-center px-2",
          )}
        >
          <LogOut className="h-5 w-5 flex-shrink-0 text-red-600" />
          {!collapsed && <span>{isLoggingOut ? "로그아웃 중..." : "로그아웃"}</span>}
        </button>
      </nav>
    </aside>
  )
}
