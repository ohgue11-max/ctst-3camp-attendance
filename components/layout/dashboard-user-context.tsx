"use client"

import { createContext, useContext } from "react"

type DashboardUserContextValue = {
  /** profiles에서 불러온 표시 이름 (헤더·인사 문구와 동일) */
  displayName: string
}

const DashboardUserContext = createContext<DashboardUserContextValue | null>(null)

export const DashboardUserProvider = DashboardUserContext.Provider

export function useDashboardUserName(): string {
  return useContext(DashboardUserContext)?.displayName ?? ""
}
