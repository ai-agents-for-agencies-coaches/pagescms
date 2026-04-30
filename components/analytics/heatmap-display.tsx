"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { HeatMapCell } from "@/lib/analytics/local-rank";
import type { HeatmapHistoryPoint } from "@/lib/analytics/queries";

const cellColor = (rank: number | null): { bg: string; text: string } => {
  if (rank == null) return { bg: "bg-slate-200 dark:bg-slate-800", text: "text-slate-500" };
  if (rank <= 3) return { bg: "bg-green-500", text: "text-white" };
  if (rank <= 10) return { bg: "bg-yellow-400", text: "text-slate-900" };
  if (rank <= 20) return { bg: "bg-orange-500", text: "text-white" };
  return { bg: "bg-red-500", text: "text-white" };
};

type GridProps = {
  grid: HeatMapCell[];
  gridSize: number;
};

export function HeatmapGrid({ grid, gridSize }: GridProps) {
  const [hovered, setHovered] = useState<HeatMapCell | null>(null);

  // Build a [row][col] → cell lookup so we render in the right order.
  const byRC = new Map<string, HeatMapCell>();
  for (const c of grid) byRC.set(`${c.row}:${c.col}`, c);

  const rows: HeatMapCell[][] = [];
  for (let r = 0; r < gridSize; r++) {
    const row: HeatMapCell[] = [];
    for (let c = 0; c < gridSize; c++) {
      const cell = byRC.get(`${r}:${c}`);
      if (cell) row.push(cell);
    }
    rows.push(row);
  }

  return (
    <div className="space-y-3">
      <div
        className="grid gap-1 mx-auto"
        style={{
          gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
          maxWidth: `${gridSize * 64}px`,
        }}
      >
        {rows.flat().map((cell) => {
          const { bg, text } = cellColor(cell.rank);
          return (
            <button
              key={`${cell.row}:${cell.col}`}
              type="button"
              onMouseEnter={() => setHovered(cell)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "aspect-square rounded-md flex items-center justify-center text-xs font-semibold transition hover:ring-2 hover:ring-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/60",
                bg,
                text,
              )}
              aria-label={`Cell ${cell.row}, ${cell.col} — rank ${cell.rank ?? "not found"}`}
            >
              {cell.rank ?? "—"}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-green-500" /> 1–3
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-yellow-400" /> 4–10
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-orange-500" /> 11–20
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-red-500" /> 21+
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-slate-300 dark:bg-slate-700" /> not found
        </span>
      </div>

      {/* Hover detail */}
      <div className="min-h-[80px] rounded-md border bg-muted/30 p-3 text-xs">
        {hovered ? (
          <div className="space-y-1">
            <div className="font-medium">
              Cell {hovered.row + 1},{hovered.col + 1} — rank{" "}
              {hovered.rank == null ? <span className="text-muted-foreground">not in top {hovered.top3.length > 0 ? "20+" : "?"}</span> : hovered.rank}
            </div>
            {hovered.top3.length > 0 && (
              <>
                <div className="text-muted-foreground">Top 3 at this cell:</div>
                <ol className="space-y-0.5 list-decimal pl-5">
                  {hovered.top3.map((c) => (
                    <li key={c.placeId} className="truncate">
                      {c.name}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground italic">Hover a cell to see rank + top competitors.</div>
        )}
      </div>
    </div>
  );
}

type TrendProps = {
  history: HeatmapHistoryPoint[];
};

export function HeatmapTrendChart({ history }: TrendProps) {
  if (history.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
        Need at least 2 weeks of data to show a trend. Check back next week.
      </div>
    );
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
          <XAxis
            dataKey="runDate"
            tickFormatter={(d: string) => format(parseISO(d), "MMM d")}
            fontSize={11}
            minTickGap={20}
          />
          <YAxis
            // Rank: lower is better, so invert the axis.
            reversed
            domain={[1, "auto"]}
            allowDecimals={false}
            fontSize={11}
            width={28}
          />
          <Tooltip
            labelFormatter={(label) =>
              typeof label === "string" ? format(parseISO(label), "MMM d, yyyy") : String(label ?? "")
            }
            formatter={((value: unknown, name: string) => {
              if (name === "averageRank")
                return [value == null ? "—" : Number(value).toFixed(1), "Avg rank"];
              return [value, name];
            }) as never}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <ReferenceLine y={3} stroke="#22c55e" strokeDasharray="4 4" label={{ value: "top 3", fontSize: 10, fill: "#22c55e", position: "right" }} />
          <Line
            type="monotone"
            dataKey="averageRank"
            stroke="#0ea5e9"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
