"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { installSafePerformanceMeasure } from "@/lib/install-safe-performance-measure"

type ProvidersProps = {
  children: React.ReactNode
}

export default function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(() => new QueryClient())

  useEffect(() => {
    installSafePerformanceMeasure()
  }, [])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
