export const maxDuration = 30;

import { type NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteKeywordTable, analyticsSiteTable } from "@/db/schema";
import { createHttpError, toErrorResponse } from "@/lib/api-error";

/**
 * Admin endpoint for bulk-seeding keyword targets at site-build time.
 * Called by local-seo-site-builder once a client's services are translated
 * into a curated keyword list.
 *
 * Auth: Bearer ADMIN_API_TOKEN (same secret as /api/admin/analytics-sites).
 *
 * Behavior: idempotent — keywords that already exist for the site are left
 * alone (returned in `existing`); new ones are inserted.
 */

type Body = {
  owner: string;
  repo: string;
  keywords: Array<{
    keyword: string;
    placeId?: string | null;
    lat?: string | null;
    lng?: string | null;
    gridSize?: number;
    radius?: number;
    radiusUnits?: "km" | "miles";
    shape?: "square" | "circle";
    zoom?: number;
    enabled?: boolean;
  }>;
};

const isAuthorized = (request: NextRequest) => {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
};

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body) throw createHttpError("Invalid JSON body.", 400);

    const owner = body.owner?.trim();
    const repo = body.repo?.trim();
    if (!owner || !repo) throw createHttpError("owner and repo are required.", 400);

    if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
      throw createHttpError("keywords[] is required and must be non-empty.", 400);
    }

    const [site] = await db
      .select({ id: analyticsSiteTable.id, gbpLocationId: analyticsSiteTable.gbpLocationId })
      .from(analyticsSiteTable)
      .where(and(eq(analyticsSiteTable.owner, owner), eq(analyticsSiteTable.repo, repo)))
      .limit(1);

    if (!site) {
      throw createHttpError(
        `No analytics_site for ${owner}/${repo}. Provision the site first via /api/admin/analytics-sites.`,
        404,
      );
    }

    const inserted: Array<{ id: number; keyword: string }> = [];
    const existing: string[] = [];

    for (const kw of body.keywords) {
      const keyword = kw.keyword?.trim();
      if (!keyword) continue;
      if (keyword.length > 200) continue;

      const [row] = await db
        .insert(analyticsSiteKeywordTable)
        .values({
          siteId: site.id,
          keyword,
          placeId: kw.placeId ?? null,
          lat: kw.lat ?? null,
          lng: kw.lng ?? null,
          gridSize: kw.gridSize ?? 5,
          radius: kw.radius ?? 5,
          radiusUnits: kw.radiusUnits ?? "km",
          shape: kw.shape ?? "square",
          zoom: kw.zoom ?? 13,
          enabled: kw.enabled ?? true,
        })
        .onConflictDoNothing({
          target: [analyticsSiteKeywordTable.siteId, analyticsSiteKeywordTable.keyword],
        })
        .returning({ id: analyticsSiteKeywordTable.id, keyword: analyticsSiteKeywordTable.keyword });

      if (row) inserted.push(row);
      else existing.push(keyword);
    }

    return NextResponse.json({
      status: "ok",
      siteId: site.id,
      inserted,
      existing,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
