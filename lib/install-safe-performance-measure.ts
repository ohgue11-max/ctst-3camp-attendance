/**
 * React/Next RSC 클라이언트 등이 performance.measure를 호출할 때,
 * mark 순서가 꼬이거나 중복 measure 이름으로 DOMException이 나는 경우가 있습니다.
 * 렌더링은 계속되도록 measure만 방어합니다.
 */
function dummyPerformanceMeasure(name: string): PerformanceMeasure {
  return {
    name,
    entryType: "measure",
    startTime: 0,
    duration: 0,
    detail: null,
    toJSON() {
      return { name, entryType: "measure", startTime: 0, duration: 0, detail: null }
    },
  } as PerformanceMeasure
}

function markExists(performanceRef: Performance, markName: string): boolean {
  return performanceRef.getEntriesByName(markName, "mark").length > 0
}

export function installSafePerformanceMeasure(): void {
  if (typeof window === "undefined") return
  const perf = window.performance
  if (!perf?.measure) return

  const extended = perf as Performance & { __ctstSafeMeasureInstalled?: boolean }
  if (extended.__ctstSafeMeasureInstalled) return
  extended.__ctstSafeMeasureInstalled = true

  const native = perf.measure.bind(perf) as (
    measureName: string,
    startOrMeasureOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ) => PerformanceMeasure

  extended.measure = ((
    measureName: string,
    startOrMeasureOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ): PerformanceMeasure => {
    try {
      if (typeof startOrMeasureOptions === "object" && startOrMeasureOptions !== null) {
        const opts = startOrMeasureOptions
        if (typeof opts.start === "string" && !markExists(perf, opts.start)) {
          console.warn("[performance] measure skipped (missing start mark)", measureName)
          return dummyPerformanceMeasure(measureName)
        }
        if (typeof opts.end === "string" && !markExists(perf, opts.end)) {
          console.warn("[performance] measure skipped (missing end mark)", measureName)
          return dummyPerformanceMeasure(measureName)
        }
      }
      if (typeof startOrMeasureOptions === "string" && endMark !== undefined) {
        if (!markExists(perf, startOrMeasureOptions) || !markExists(perf, endMark)) {
          console.warn("[performance] measure skipped (missing start/end mark)", measureName)
          return dummyPerformanceMeasure(measureName)
        }
      }
      return native(measureName, startOrMeasureOptions, endMark)
    } catch (error) {
      console.warn("[performance] measure skipped", measureName, error)
      return dummyPerformanceMeasure(measureName)
    }
  }) as typeof perf.measure
}
