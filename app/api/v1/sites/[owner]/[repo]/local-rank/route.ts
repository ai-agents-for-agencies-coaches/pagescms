export const maxDuration = 30;

import { type NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteTable } from "@/db/schema";
import {
  getKeywords,
  getLatestHeatMap,
  getHeatMapHistory,
} from "@/lib/analytics/queries";

/**
 * Agency-side external API: full local-rank export for a single site.
 *
 * Auth: Bearer ADMIN_API_TOKEN.
 *
 * Returns, for the given owner/repo:
 *   - site metadata (gbp, timezone, last sync)
 *   - every keyword with its latest heat-map run (grid + summary)
 *   - 12-week trend per keyword (avg rank, foundPercent, top3Percent)
 *
 * Query params:
 *   - `weeks` — history window (default 12, max 52)
 *   - `includeGrid` — set "false" to skip the heavy grid arrays (default true)
 */

const isAuthorized = (request: NextRequest) => {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
};

const parseWeeks = (s: string | null): number => {
  const n = s ? parseInt(s, 10) : 12;
  return Number.isFinite(n) && n > 0 && n <= 52 ? n : 12;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string }> },
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const { owner, repo } = await context.params;

  const [site] = await db
    .select()
    .from(analyticsSiteTable)
    .where(and(eq(analyticsSiteTable.owner, owner), eq(analyticsSiteTable.repo, repo)))
    .limit(1);

  if (!site) {
    return NextResponse.json(
      { status: "error", message: `No analytics_site for ${owner}/${repo}` },
      { status: 404 },
    );
  }

  const weeks = parseWeeks(request.nextUrl.searchParams.get("weeks"));
  const includeGrid = request.nextUrl.searchParams.get("includeGrid") !== "false";

  const keywords = await getKeywords(site.id);

  // Hydrate each keyword with its latest grid + history. Sequential to avoid
  // hammering the connection pool on sites with many keywords; if it gets
  // slow we can swap to a bounded-concurrency Promise.all.
  const enriched = await Promise.all(
    keywords.map(async (k) => {
      const [latest, history] = await Promise.all([
        getLatestHeatMap(site.id, k.id),
        getHeatMapHistory(site.id, k.id, weeks),
      ]);
      return {
        id: k.id,
        keyword: k.keyword,
        enabled: k.enabled,
        gridSize: k.gridSize,
        radius: { value: k.radius, units: k.radiusUnits },
        shape: k.shape,
        zoom: k.zoom,
        anchor: k.placeId
          ? { placeId: k.placeId, lat: k.lat, lng: k.lng }
          : null,
        latestRun: latest
          ? {
              runDate: latest.runDate,
              summary: latest.summary,
              grid: includeGrid ? latest.grid : undefined,
              errorReason: latest.errorReason,
              fetchedAt: latest.fetchedAt,
            }
          : null,
        history,
      };
    }),
  );

  return NextResponse.json({
    status: "ok",
    site: {
      owner: site.owner,
      repo: site.repo,
      timezone: site.timezone,
      gbp: site.gbpLocationName
        ? {
            accountId: site.gbpAccountId,
            locationId: site.gbpLocationId,
            locationName: site.gbpLocationName,
            connectedAt: site.gbpConnectedAt,
          }
        : null,
      lastSyncedAt: site.lastSyncedAt,
    },
    window: { weeks },
    keywords: enriched,
  });
}
