export const maxDuration = 30;

import { type NextRequest, NextResponse } from "next/server";
import { getRepoAnalyticsContext } from "@/lib/analytics/repo-context";
import {
  getLatestHeatMap,
  getHeatMapForRun,
  getHeatMapHistory,
} from "@/lib/analytics/queries";
import { toErrorResponse } from "@/lib/api-error";

const parseInt10 = (s: string | null, fallback: number): number => {
  if (!s) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const params = await context.params;
    const { site } = await getRepoAnalyticsContext(params);
    if (!site) return NextResponse.json({ status: "ok", latest: null, history: [] });

    const keywordIdParam = request.nextUrl.searchParams.get("keywordId");
    if (!keywordIdParam) {
      return NextResponse.json({ status: "error", message: "keywordId is required" }, { status: 400 });
    }
    const keywordId = parseInt(keywordIdParam, 10);
    if (!Number.isFinite(keywordId) || keywordId <= 0) {
      return NextResponse.json({ status: "error", message: "Invalid keywordId" }, { status: 400 });
    }

    const weeks = parseInt10(request.nextUrl.searchParams.get("weeks"), 12);
    const runDate = request.nextUrl.searchParams.get("runDate");

    const [latest, history] = await Promise.all([
      runDate
        ? getHeatMapForRun(site.id, keywordId, runDate)
        : getLatestHeatMap(site.id, keywordId),
      getHeatMapHistory(site.id, keywordId, weeks),
    ]);

    return NextResponse.json({ status: "ok", latest, history });
  } catch (error) {
    return toErrorResponse(error);
  }
}
