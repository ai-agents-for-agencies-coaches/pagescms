"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO, startOfWeek } from "date-fns";
import type { GbpTimeseriesPoint } from "@/lib/analytics/queries";

type Props = {
  points: GbpTimeseriesPoint[];
  granularity: "day" | "week";
};

const bucketKey = (date: string, granularity: "day" | "week") => {
  if (granularity === "day") return date;
  return format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");
};

const aggregate = (points: GbpTimeseriesPoint[], granularity: "day" | "week") => {
  const by = new Map<string, GbpTimeseriesPoint>();
  for (const p of points) {
    const key = bucketKey(p.date, granularity);
    const existing =
      by.get(key) ?? {
        date: key,
        searchImpressions: 0,
        mapsImpressions: 0,
        callClicks: 0,
        websiteClicks: 0,
        directionRequests: 0,
        conversations: 0,
        bookings: 0,
      };
    existing.searchImpressions += p.searchImpressions;
    existing.mapsImpressions += p.mapsImpressions;
    existing.callClicks += p.callClicks;
    existing.websiteClicks += p.websiteClicks;
    existing.directionRequests += p.directionRequests;
    existing.conversations += p.conversations;
    existing.bookings += p.bookings;
    by.set(key, existing);
  }
  return Array.from(by.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
};

const tooltipLabel = (label: unknown, granularity: "day" | "week") =>
  typeof label === "string"
    ? format(parseISO(label), granularity === "week" ? "'Week of' MMM d" : "EEE, MMM d, yyyy")
    : String(label ?? "");

export function GbpImpressionsChart({ points, granularity }: Props) {
  const data = aggregate(points, granularity);
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => format(parseISO(d), "MMM d")}
            fontSize={11}
            minTickGap={24}
          />
          <YAxis fontSize={11} width={36} allowDecimals={false} />
          <Tooltip
            labelFormatter={(label) => tooltipLabel(label, granularity)}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="searchImpressions" name="Search" stackId="impressions" fill="#0ea5e9" radius={[0, 0, 0, 0]} />
          <Bar dataKey="mapsImpressions" name="Maps" stackId="impressions" fill="#22c55e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GbpActionsChart({ points, granularity }: Props) {
  const data = aggregate(points, granularity);
  const hasBookings = data.some((d) => d.bookings > 0);
  const hasConversations = data.some((d) => d.conversations > 0);
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => format(parseISO(d), "MMM d")}
            fontSize={11}
            minTickGap={24}
          />
          <YAxis fontSize={11} width={36} allowDecimals={false} />
          <Tooltip
            labelFormatter={(label) => tooltipLabel(label, granularity)}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="callClicks" name="Calls" stackId="actions" fill="#0ea5e9" />
          <Bar dataKey="websiteClicks" name="Website" stackId="actions" fill="#22c55e" />
          <Bar dataKey="directionRequests" name="Directions" stackId="actions" fill="#f59e0b" />
          {hasConversations && (
            <Bar dataKey="conversations" name="Messages" stackId="actions" fill="#a855f7" />
          )}
          {hasBookings && (
            <Bar dataKey="bookings" name="Bookings" stackId="actions" fill="#ec4899" radius={[4, 4, 0, 0]} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
