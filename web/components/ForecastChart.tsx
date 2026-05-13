"use client";

import {
  Area,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ForecastPoint } from "@/lib/data";

const TICK = { fill: "#a1a1aa", fontSize: 11 };

export function ForecastChart({ data }: { data: ForecastPoint[] }) {
  // Build a single series; recharts plots null gaps cleanly
  const splitDate = data.find((d) => d.forecast !== null)?.date ?? null;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
          <XAxis
            dataKey="date"
            tick={TICK}
            tickFormatter={(d) => d.slice(5)}
            minTickGap={32}
          />
          <YAxis tick={TICK} width={48} />
          <Tooltip
            contentStyle={{
              background: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#a1a1aa" }}
          />
          <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 11 }} />
          <Area
            type="monotone"
            dataKey="upper"
            stroke="none"
            fill="#22c55e"
            fillOpacity={0.1}
            isAnimationActive={false}
            name="Upper 95%"
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="lower"
            stroke="none"
            fill="#0a0a0a"
            fillOpacity={1}
            isAnimationActive={false}
            name="Lower 95%"
            legendType="none"
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#e4e4e7"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
            name="Actual"
          />
          <Line
            type="monotone"
            dataKey="forecast"
            stroke="#22c55e"
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
            name="Forecast"
          />
          {splitDate && (
            <ReferenceLine
              x={splitDate}
              stroke="#52525b"
              strokeDasharray="4 4"
              label={{ value: "forecast", position: "top", fill: "#71717a", fontSize: 10 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
