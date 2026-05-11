export const maxDuration = 30;

import { type NextRequest, NextResponse } from "next/server";
import { getRepoAnalyticsContext } from "@/lib/analytics/repo-context";
import { getGbpSummary, getGbpTimeseries } from "@/lib/analytics/queries";
import { toErrorResponse } from "@/lib/api-error";

const parseDays = (s: string | null) => {
  const n = s ? parseInt(s, 10) : 28;
  return Number.isFinite(n) && n > 0 && n <= 480 ? n : 28;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const params = await context.params;
    const { site } = await getRepoAnalyticsContext(params);
    if (!site) {
      return NextResponse.json({ status: "ok", connected: false, summary: null, points: [] });
    }
    if (!site.gbpLocationId) {
      return NextResponse.json({
        status: "ok",
        connected: false,
        locationName: null,
        summary: null,
        points: [],
      });
    }

    const days = parseDays(request.nextUrl.searchParams.get("days"));
    const [summary, points] = await Promise.all([
      getGbpSummary(site.id, days),
      getGbpTimeseries(site.id, days),
    ]);

    return NextResponse.json({
      status: "ok",
      connected: true,
      locationName: site.gbpLocationName,
      summary,
      points,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
