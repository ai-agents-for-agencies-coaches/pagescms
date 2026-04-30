export const maxDuration = 300;

import { type NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  analyticsHeatmapRunTable,
  analyticsSiteKeywordTable,
  analyticsSiteTable,
} from "@/db/schema";
import { fetchHeatMap } from "@/lib/analytics/local-rank";

/**
 * Weekly local-rank heat-map sync. Vercel Cron at Mon 02:00 UTC; also callable
 * by hand with `Authorization: Bearer $CRON_SECRET` for ad-hoc runs.
 *
 * Query params:
 *   - owner + repo: scope to a single site
 *   - keywordId:    scope to a single keyword (must also pass owner+repo)
 */

const isAuthorized = (request: NextRequest) => {
  const fromVercelCron = request.headers.get("user-agent")?.includes("vercel-cron");
  if (fromVercelCron) return true;
  const header = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return header === `Bearer ${expected}`;
};

const today = () => new Date().toISOString().slice(0, 10);

type KeywordRow = {
  id: number;
  siteId: number;
  keyword: string;
  placeId: string | null;
  lat: string | null;
  lng: string | null;
  gridSize: number;
  radius: number;
  radiusUnits: string;
  shape: string;
  zoom: number;
};

const runOne = async (
  kw: KeywordRow,
  fallback: { placeId: string | null; lat: number | null; lng: number | null },
) => {
  const placeId = kw.placeId ?? fallback.placeId;
  const lat = kw.lat ?? (fallback.lat != null ? String(fallback.lat) : null);
  const lng = kw.lng ?? (fallback.lng != null ? String(fallback.lng) : null);

  const runDate = today();

  if (!placeId || !lat || !lng) {
    await db
      .insert(analyticsHeatmapRunTable)
      .values({
        siteId: kw.siteId,
        keywordId: kw.id,
        runDate,
        summary: {},
        grid: [],
        errorReason: "Missing place_id / lat / lng — connect GBP or set keyword anchor.",
      })
      .onConflictDoUpdate({
        target: [
          analyticsHeatmapRunTable.siteId,
          analyticsHeatmapRunTable.keywordId,
          analyticsHeatmapRunTable.runDate,
        ],
        set: {
          summary: sql`excluded.summary`,
          grid: sql`excluded.grid`,
          errorReason: sql`excluded.error_reason`,
          fetchedAt: new Date(),
        },
      });
    return { ok: false as const, keyword: kw.keyword, reason: "missing-anchor" };
  }

  try {
    const result = await fetchHeatMap({
      keyword: kw.keyword,
      placeId,
      lat,
      lng,
      gridSize: kw.gridSize,
      radius: kw.radius,
      radiusUnits: kw.radiusUnits as "km" | "miles",
      shape: kw.shape as "square" | "circle",
      zoom: kw.zoom,
    });

    await db
      .insert(analyticsHeatmapRunTable)
      .values({
        siteId: kw.siteId,
        keywordId: kw.id,
        runDate,
        summary: result.summary,
        grid: result.grid,
        errorReason: null,
      })
      .onConflictDoUpdate({
        target: [
          analyticsHeatmapRunTable.siteId,
          analyticsHeatmapRunTable.keywordId,
          analyticsHeatmapRunTable.runDate,
        ],
        set: {
          summary: sql`excluded.summary`,
          grid: sql`excluded.grid`,
          errorReason: null,
          fetchedAt: new Date(),
        },
      });

    return { ok: true as const, keyword: kw.keyword, foundPercent: result.summary.foundPercent };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    await db
      .insert(analyticsHeatmapRunTable)
      .values({
        siteId: kw.siteId,
        keywordId: kw.id,
        runDate,
        summary: {},
        grid: [],
        errorReason: reason.slice(0, 500),
      })
      .onConflictDoUpdate({
        target: [
          analyticsHeatmapRunTable.siteId,
          analyticsHeatmapRunTable.keywordId,
          analyticsHeatmapRunTable.runDate,
        ],
        set: {
          summary: sql`excluded.summary`,
          grid: sql`excluded.grid`,
          errorReason: sql`excluded.error_reason`,
          fetchedAt: new Date(),
        },
      });
    return { ok: false as const, keyword: kw.keyword, reason };
  }
};

const handler = async (request: NextRequest) => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  const keywordIdParam = searchParams.get("keywordId");

  // Resolve site scope
  let siteFilter = and(eq(analyticsSiteKeywordTable.enabled, true));
  let scopedSites: Array<{ id: number; gbpLocationId: string | null }> = [];

  if (owner && repo) {
    const sites = await db
      .select({ id: analyticsSiteTable.id, gbpLocationId: analyticsSiteTable.gbpLocationId })
      .from(analyticsSiteTable)
      .where(and(eq(analyticsSiteTable.owner, owner), eq(analyticsSiteTable.repo, repo)));
    if (sites.length === 0) {
      return NextResponse.json({ status: "error", message: `No analytics_site for ${owner}/${repo}` }, { status: 404 });
    }
    scopedSites = sites;
    siteFilter = and(
      eq(analyticsSiteKeywordTable.enabled, true),
      eq(analyticsSiteKeywordTable.siteId, sites[0].id),
    );
  } else {
    scopedSites = await db
      .select({ id: analyticsSiteTable.id, gbpLocationId: analyticsSiteTable.gbpLocationId })
      .from(analyticsSiteTable);
  }

  const keywords = await db
    .select({
      id: analyticsSiteKeywordTable.id,
      siteId: analyticsSiteKeywordTable.siteId,
      keyword: analyticsSiteKeywordTable.keyword,
      placeId: analyticsSiteKeywordTable.placeId,
      lat: analyticsSiteKeywordTable.lat,
      lng: analyticsSiteKeywordTable.lng,
      gridSize: analyticsSiteKeywordTable.gridSize,
      radius: analyticsSiteKeywordTable.radius,
      radiusUnits: analyticsSiteKeywordTable.radiusUnits,
      shape: analyticsSiteKeywordTable.shape,
      zoom: analyticsSiteKeywordTable.zoom,
    })
    .from(analyticsSiteKeywordTable)
    .where(
      keywordIdParam
        ? and(
            eq(analyticsSiteKeywordTable.id, parseInt(keywordIdParam, 10)),
            eq(analyticsSiteKeywordTable.enabled, true),
          )
        : siteFilter,
    );

  // For each site, fetch GBP fallback (place_id is in gbp_location_id; lat/lng we don't have on site row,
  // so per-keyword anchors must be set if not connected to GBP location data via override).
  // For now, we use gbpLocationId as the placeId fallback only if it looks like a Google Place ID.
  const siteFallback = new Map<number, { placeId: string | null; lat: number | null; lng: number | null }>();
  for (const s of scopedSites) {
    siteFallback.set(s.id, {
      placeId: s.gbpLocationId && s.gbpLocationId.startsWith("ChIJ") ? s.gbpLocationId : null,
      lat: null,
      lng: null,
    });
  }

  const results: Array<{ ok: boolean; keyword: string; foundPercent?: number; reason?: string }> = [];
  // Sequential to respect RapidAPI rate limits.
  for (const kw of keywords) {
    const fallback = siteFallback.get(kw.siteId) ?? { placeId: null, lat: null, lng: null };
    results.push(await runOne(kw as KeywordRow, fallback));
  }

  return NextResponse.json({
    status: "ok",
    runDate: today(),
    keywordsProcessed: keywords.length,
    results,
  });
};

export const GET = handler;
export const POST = handler;
