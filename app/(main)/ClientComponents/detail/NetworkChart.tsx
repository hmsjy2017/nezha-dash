"use client"

import { NezhaAPIMonitor, ServerMonitorChart } from "@/app/types/nezha-api"
import NetworkChartLoading from "@/components/loading/NetworkChartLoading"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import getEnv from "@/lib/env-entry"
import { formatTime, nezhaFetcher } from "@/lib/utils"
import { formatRelativeTime } from "@/lib/utils"
import { useTranslations } from "next-intl"
import * as React from "react"
import { useCallback, useMemo } from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import useSWR from "swr"

interface ResultItem {
  created_at: number
  [key: string]: number
}

export function NetworkChartClient({ server_id, show }: { server_id: number; show: boolean }) {
  const t = useTranslations("NetworkChartClient")
  const { data, error } = useSWR<NezhaAPIMonitor[]>(
    `/api/monitor?server_id=${server_id}`,
    nezhaFetcher,
    {
      refreshInterval: Number(getEnv("NEXT_PUBLIC_NezhaFetchInterval")) || 15000,
      isVisible: () => show,
    },
  )

  if (error) {
    return (
      <>
        <div className="flex flex-col items-center justify-center">
          <p className="text-sm font-medium opacity-40">{error.message}</p>
          <p className="text-sm font-medium opacity-40">{t("chart_fetch_error_message")}</p>
        </div>
        <NetworkChartLoading />
      </>
    )
  }

  if (!data) return <NetworkChartLoading />

  const transformedData = transformData(data)

  const formattedData = formatData(data)

  const initChartConfig = {
    avg_delay: {
      label: t("avg_delay"),
    },
  } satisfies ChartConfig

  const chartDataKey = Object.keys(transformedData)

  return (
    <NetworkChart
      chartDataKey={chartDataKey}
      chartConfig={initChartConfig}
      chartData={transformedData}
      serverName={data[0].server_name}
      formattedData={formattedData}
    />
  )
}

export const NetworkChart = React.memo(function NetworkChart({
  chartDataKey,
  chartConfig,
  chartData,
  serverName,
  formattedData,
}: {
  chartDataKey: string[]
  chartConfig: ChartConfig
  chartData: ServerMonitorChart
  serverName: string
  formattedData: ResultItem[]
}) {
  const t = useTranslations("NetworkChart")

  const defaultChart = "All"

  const [activeChart, setActiveChart] = React.useState(defaultChart)
  const [isPeakEnabled, setIsPeakEnabled] = React.useState(false)

  const handleButtonClick = useCallback(
    (chart: string) => {
      setActiveChart((prev) => (prev === chart ? defaultChart : chart))
    },
    [defaultChart],
  )

  const getColorByIndex = useCallback(
    (chart: string) => {
      const index = chartDataKey.indexOf(chart)
      return `hsl(var(--chart-${(index % 10) + 1}))`
    },
    [chartDataKey],
  )

  const chartButtons = useMemo(
    () =>
      chartDataKey.map((key) => (
        <button
          key={key}
          data-active={activeChart === key}
          className={`relative z-30 flex cursor-pointer grow basis-0 flex-col justify-center gap-1 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4 text-left data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0 sm:px-6`}
          onClick={() => handleButtonClick(key)}
        >
          <span className="whitespace-nowrap text-xs text-muted-foreground">{key}</span>
          <span className="text-md font-bold leading-none sm:text-lg">
            {chartData[key][chartData[key].length - 1].avg_delay.toFixed(2)}ms
          </span>
        </button>
      )),
    [chartDataKey, activeChart, chartData, handleButtonClick],
  )

  const chartLines = useMemo(() => {
    if (activeChart !== defaultChart) {
      return (
        <Line
          isAnimationActive={false}
          strokeWidth={1}
          type="linear"
          dot={false}
          dataKey="avg_delay"
          stroke={getColorByIndex(activeChart)}
        />
      )
    }
    return chartDataKey.map((key) => (
      <Line
        key={key}
        isAnimationActive={false}
        strokeWidth={1}
        type="linear"
        dot={false}
        dataKey={key}
        stroke={getColorByIndex(key)}
        connectNulls={true}
      />
    ))
  }, [activeChart, defaultChart, chartDataKey, getColorByIndex])

  const processedData = useMemo(() => {
    if (!isPeakEnabled) {
      return activeChart === defaultChart ? formattedData : chartData[activeChart]
    }

    // 如果开启了削峰，对数据进行处理
    const data = (
      activeChart === defaultChart ? formattedData : chartData[activeChart]
    ) as ResultItem[]
    const windowSize = 7 // 增加到7个点的移动平均
    const weights = [0.1, 0.1, 0.15, 0.3, 0.15, 0.1, 0.1] // 加权平均的权重

    return data.map((point, index) => {
      if (index < windowSize - 1) return point

      const window = data.slice(index - windowSize + 1, index + 1)
      const smoothed = { ...point } as ResultItem

      if (activeChart === defaultChart) {
        // 处理所有线路的数据
        chartDataKey.forEach((key) => {
          const values = window
            .map((w) => w[key])
            .filter((v) => v !== undefined && v !== null) as number[]
          if (values.length === windowSize) {
            smoothed[key] = values.reduce((acc, val, idx) => acc + val * weights[idx], 0)
          }
        })
      } else {
        // 处理单条线路的数据
        const values = window
          .map((w) => w.avg_delay)
          .filter((v) => v !== undefined && v !== null) as number[]
        if (values.length === windowSize) {
          smoothed.avg_delay = values.reduce((acc, val, idx) => acc + val * weights[idx], 0)
        }
      }

      return smoothed
    })
  }, [isPeakEnabled, activeChart, formattedData, chartData, chartDataKey, defaultChart])

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch space-y-0 p-0 sm:flex-row">
        <div className="flex flex-none flex-col justify-center gap-1 border-b px-6 py-4">
          <CardTitle className="flex flex-none items-center gap-0.5 text-md">
            {serverName}
          </CardTitle>
          <CardDescription className="text-xs">
            {chartDataKey.length} {t("ServerMonitorCount")}
          </CardDescription>
          <div className="flex items-center mt-0.5 space-x-2">
            <Switch id="Peak" checked={isPeakEnabled} onCheckedChange={setIsPeakEnabled} />
            <Label className="text-xs" htmlFor="Peak">
              Peak cut
            </Label>
          </div>
        </div>
        <div className="flex flex-wrap w-full">{chartButtons}</div>
      </CardHeader>
      <CardContent className="pr-2 pl-0 py-4 sm:pt-6 sm:pb-6 sm:pr-6 sm:pl-2">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <LineChart accessibilityLayer data={processedData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="created_at"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              interval={"preserveStartEnd"}
              tickFormatter={(value) => formatRelativeTime(value)}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={15}
              minTickGap={20}
              tickFormatter={(value) => `${value}ms`}
            />
            <ChartTooltip
              isAnimationActive={false}
              content={
                <ChartTooltipContent
                  indicator={"line"}
                  labelKey="created_at"
                  labelFormatter={(_, payload) => {
                    return formatTime(payload[0].payload.created_at)
                  }}
                />
              }
            />
            {activeChart === defaultChart && <ChartLegend content={<ChartLegendContent />} />}
            {chartLines}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
})

const transformData = (data: NezhaAPIMonitor[]) => {
  const monitorData: ServerMonitorChart = {}

  data.forEach((item) => {
    const monitorName = item.monitor_name

    if (!monitorData[monitorName]) {
      monitorData[monitorName] = []
    }

    for (let i = 0; i < item.created_at.length; i++) {
      monitorData[monitorName].push({
        created_at: item.created_at[i],
        avg_delay: item.avg_delay[i],
      })
    }
  })

  return monitorData
}

const formatData = (rawData: NezhaAPIMonitor[]) => {
  const result: { [time: number]: ResultItem } = {}

  const allTimes = new Set<number>()
  rawData.forEach((item) => {
    item.created_at.forEach((time) => allTimes.add(time))
  })

  const allTimeArray = Array.from(allTimes).sort((a, b) => a - b)

  rawData.forEach((item) => {
    const { monitor_name, created_at, avg_delay } = item

    allTimeArray.forEach((time) => {
      if (!result[time]) {
        result[time] = { created_at: time }
      }

      const timeIndex = created_at.indexOf(time)
      // @ts-expect-error - avg_delay is an array
      result[time][monitor_name] = timeIndex !== -1 ? avg_delay[timeIndex] : null
    })
  })

  return Object.values(result).sort((a, b) => a.created_at - b.created_at)
}