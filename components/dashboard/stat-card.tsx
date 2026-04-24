import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  description?: string
  trend?: {
    value: number
    isPositive: boolean
  }
  variant?: "default" | "warning" | "success" | "destructive"
  /** 추가근무 등 누적이 임계 이상일 때 카드 테두리 강조 */
  emphasizeBlue?: boolean
}

export function StatCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  variant = "default",
  emphasizeBlue = false,
}: StatCardProps) {
  const variantStyles = {
    default: "bg-primary/10 text-primary",
    warning: "bg-amber-100 text-amber-600",
    success: "bg-emerald-100 text-emerald-600",
    destructive: "bg-red-100 text-red-600",
  }

  return (
    <Card
      className={cn(
        "border-slate-200 shadow-sm",
        emphasizeBlue && "border-blue-200 ring-1 ring-blue-100",
      )}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold text-foreground">{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
            {trend && (
              <p
                className={cn(
                  "text-xs font-medium",
                  trend.isPositive ? "text-emerald-600" : "text-red-600"
                )}
              >
                {trend.isPositive ? "+" : "-"}{Math.abs(trend.value)}% 전월 대비
              </p>
            )}
          </div>
          <div className={cn("p-3 rounded-lg", variantStyles[variant])}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
