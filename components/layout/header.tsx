"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Menu, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { supabase } from "@/lib/supabase/client"

interface HeaderProps {
  userName?: string
  userRole?: "employee" | "admin"
  onMenuClick?: () => void
}

export function Header({ userName = "", userRole = "employee", onMenuClick }: HeaderProps) {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    if (isSigningOut) return

    setIsSigningOut(true)
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error("[header] sign out error:", error)
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
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="lg:hidden hover:bg-slate-100" onClick={onMenuClick}>
          <Menu className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{userName}님 안녕하세요</h2>
          <p className="text-sm text-slate-500">역할: {userRole}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="relative hover:bg-slate-100">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-[#1185cc] rounded-full" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 hover:bg-slate-100">
              <div className="w-8 h-8 rounded-full bg-[#e8f2fb] flex items-center justify-center">
                <User className="w-4 h-4 text-[#1185cc]" />
              </div>
              <span className="hidden sm:inline text-sm font-medium">{userName}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>내 계정</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>프로필 설정</DropdownMenuItem>
            <DropdownMenuItem>비밀번호 변경</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="w-full cursor-pointer text-destructive"
              onSelect={(event) => {
                event.preventDefault()
                void handleSignOut()
              }}
              disabled={isSigningOut}
            >
              {isSigningOut ? "로그아웃 중..." : "로그아웃"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
