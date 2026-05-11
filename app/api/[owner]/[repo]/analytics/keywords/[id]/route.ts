export const maxDuration = 30;

import { type NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteKeywordTable } from "@/db/schema";
import { getRepoAnalyticsContext } from "@/lib/analytics/repo-context";
import { toErrorResponse } from "@/lib/api-error";

type RouteParams = { owner: string; repo: string; id: string };
type PatchBody = {
  keyword?: string;
  enabled?: boolean;
  placeId?: string | null;
  lat?: string | null;
  lng?: string | null;
  gridSize?: number;
  radius?: number;
  radiusUnits?: "km" | "miles";
  shape?: "square" | "circle";
  zoom?: number;
};

const parseId = (s: string): number | null => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  try {
    const params = await context.params;
    const { site } = await getRepoAnalyticsContext(params);
    if (!site) return NextResponse.json({ status: "error", message: "Site not found" }, { status: 404 });

    const id = parseId(params.id);
    if (!id) return NextResponse.json({ status: "error", message: "Invalid id" }, { status: 400 });

    const body = (await request.json()) as PatchBody;
    const update: Partial<typeof analyticsSiteKeywordTable.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.keyword === "string") {
      const trimmed = body.keyword.trim();
      if (!trimmed || trimmed.length > 200) {
        return NextResponse.json({ status: "error", message: "keyword must be 1–200 chars" }, { status: 400 });
      }
      update.keyword = trimmed;
    }
    if (typeof body.enabled === "boolean") update.enabled = body.enabled;
    if (body.placeId !== undefined) update.placeId = body.placeId;
    if (body.lat !== undefined) update.lat = body.lat;
    if (body.lng !== undefined) update.lng = body.lng;
    if (typeof body.gridSize === "number") update.gridSize = body.gridSize;
    if (typeof body.radius === "number") update.radius = body.radius;
    if (body.radiusUnits) update.radiusUnits = body.radiusUnits;
    if (body.shape) update.shape = body.shape;
    if (typeof body.zoom === "number") update.zoom = body.zoom;

    const [row] = await db
      .update(analyticsSiteKeywordTable)
      .set(update)
      .where(
        and(
          eq(analyticsSiteKeywordTable.id, id),
          eq(analyticsSiteKeywordTable.siteId, site.id),
        ),
      )
      .returning();

    if (!row) {
      return NextResponse.json({ status: "error", message: "Keyword not found" }, { status: 404 });
    }
    return NextResponse.json({ status: "ok", keyword: row });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  try {
    const params = await context.params;
    const { site } = await getRepoAnalyticsContext(params);
    if (!site) return NextResponse.json({ status: "error", message: "Site not found" }, { status: 404 });

    const id = parseId(params.id);
    if (!id) return NextResponse.json({ status: "error", message: "Invalid id" }, { status: 400 });

    const [row] = await db
      .delete(analyticsSiteKeywordTable)
      .where(
        and(
          eq(analyticsSiteKeywordTable.id, id),
          eq(analyticsSiteKeywordTable.siteId, site.id),
        ),
      )
      .returning({ id: analyticsSiteKeywordTable.id });

    if (!row) {
      return NextResponse.json({ status: "error", message: "Keyword not found" }, { status: 404 });
    }
    return NextResponse.json({ status: "ok", id: row.id });
  } catch (error) {
    return toErrorResponse(error);
  }
}
