export const maxDuration = 30;

import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analyticsSiteKeywordTable } from "@/db/schema";
import { getRepoAnalyticsContext } from "@/lib/analytics/repo-context";
import { getKeywords } from "@/lib/analytics/queries";
import { toErrorResponse } from "@/lib/api-error";

const MAX_KEYWORDS_PER_SITE = 25;

type AddKeywordBody = {
  keyword: string;
  placeId?: string;
  lat?: string;
  lng?: string;
  gridSize?: number;
  radius?: number;
  radiusUnits?: "km" | "miles";
  shape?: "square" | "circle";
  zoom?: number;
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const params = await context.params;
    const { site } = await getRepoAnalyticsContext(params);
    if (!site) return NextResponse.json({ status: "ok", keywords: [] });
    const keywords = await getKeywords(site.id);
    return NextResponse.json({ status: "ok", keywords });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const params = await context.params;
    const { site } = await getRepoAnalyticsContext(params);
    if (!site) return NextResponse.json({ status: "error", message: "Site not found" }, { status: 404 });

    const body = (await request.json()) as AddKeywordBody;
    const keyword = (body.keyword ?? "").trim();
    if (!keyword) {
      return NextResponse.json({ status: "error", message: "keyword is required" }, { status: 400 });
    }
    if (keyword.length > 200) {
      return NextResponse.json({ status: "error", message: "keyword too long" }, { status: 400 });
    }

    const existing = await getKeywords(site.id);
    if (existing.length >= MAX_KEYWORDS_PER_SITE) {
      return NextResponse.json(
        { status: "error", message: `Limit of ${MAX_KEYWORDS_PER_SITE} keywords per site reached.` },
        { status: 400 },
      );
    }

    const [row] = await db
      .insert(analyticsSiteKeywordTable)
      .values({
        siteId: site.id,
        keyword,
        placeId: body.placeId ?? null,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        gridSize: body.gridSize ?? 5,
        radius: body.radius ?? 5,
        radiusUnits: body.radiusUnits ?? "km",
        shape: body.shape ?? "square",
        zoom: body.zoom ?? 13,
        enabled: true,
      })
      .onConflictDoNothing({
        target: [analyticsSiteKeywordTable.siteId, analyticsSiteKeywordTable.keyword],
      })
      .returning();

    if (!row) {
      return NextResponse.json(
        { status: "error", message: "Keyword already exists for this site." },
        { status: 409 },
      );
    }

    return NextResponse.json({ status: "ok", keyword: row });
  } catch (error) {
    return toErrorResponse(error);
  }
}
