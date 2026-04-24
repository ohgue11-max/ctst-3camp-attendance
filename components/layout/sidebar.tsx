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
  const [isSigningOut, setIsSigningOut] = useState(false)

  const employeeNavItems = [
    { href: "/dashboard/employee", label: "대시보드", icon: LayoutDashboard },
    { href: "/dashboard/employee/attendance", label: "내 근태 조회", icon: Clock },
    { href: "/dashboard/employee/upload", label: "엑셀 업로드", icon: FileSpreadsheet },
    { href: "/dashboard/admin/collect", label: "관리자 취합", icon: ShieldCheck },
    { href: "/dashboard/settings", label: "설정", icon: Settings },
  ]

  const adminNavItems = [
    { href: "/dashboard/admin", label: "대시보드", icon: Home },
    { href: "/dashboard/employee/attendance", label: "내 근태 조회", icon: Clock },
    { href: "/dashboard/employee/upload", label: "엑셀 업로드", icon: FileSpreadsheet },
    { href: "/dashboard/admin/collect", label: "관리자 취합", icon: ShieldCheck },
    { href: "/dashboard/settings", label: "설정", icon: Settings },
  ]

  const navItems = isAdmin ? adminNavItems : employeeNavItems

  const handleSignOut = async () => {
    if (isSigningOut) return

    setIsSigningOut(true)
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error("[sidebar] sign out error:", error)
      setIsSigningOut(false)
      return
    }

    router.replace("/login")
    router.refresh()

    if (typeof window !== "undefined") {
      window.location.replace("/login")
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
      </nav>

      <div className="p-3 border-t border-slate-200">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className={cn(
            "flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            collapsed && "justify-center"
          )}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>{isSigningOut ? "로그아웃 중..." : "로그아웃"}</span>}
        </button>
      </div>
    </aside>
  )
}
