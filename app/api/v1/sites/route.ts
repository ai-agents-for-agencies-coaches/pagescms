export const maxDuration = 30;

import { type NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteTable, analyticsSiteKeywordTable } from "@/db/schema";

/**
 * Agency-side external API: list all analytics sites with light metadata.
 *
 * Auth: Bearer ADMIN_API_TOKEN (server-to-server only — do not expose to clients).
 *
 * Use cases: powering an agency-wide reporting tool, syncing client roster
 * into Notion/Sheets/etc., kicking off per-site `/local-rank` pulls.
 */

const isAuthorized = (request: NextRequest) => {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
};

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const sites = await db
    .select({
      id: analyticsSiteTable.id,
      owner: analyticsSiteTable.owner,
      repo: analyticsSiteTable.repo,
      timezone: analyticsSiteTable.timezone,
      gbpLocationName: analyticsSiteTable.gbpLocationName,
      gbpConnectedAt: analyticsSiteTable.gbpConnectedAt,
      lastSyncedAt: analyticsSiteTable.lastSyncedAt,
    })
    .from(analyticsSiteTable)
    .orderBy(analyticsSiteTable.owner, analyticsSiteTable.repo);

  // Per-site keyword counts in a single grouped query.
  const keywordCounts = await db
    .select({
      siteId: analyticsSiteKeywordTable.siteId,
      total: sql<number>`count(*)::int`,
      enabled: sql<number>`count(*) FILTER (WHERE ${analyticsSiteKeywordTable.enabled})::int`,
    })
    .from(analyticsSiteKeywordTable)
    .groupBy(analyticsSiteKeywordTable.siteId);
  const countsBySite = new Map(keywordCounts.map((r) => [r.siteId, r]));

  return NextResponse.json({
    status: "ok",
    sites: sites.map((s) => {
      const counts = countsBySite.get(s.id);
      return {
        owner: s.owner,
        repo: s.repo,
        timezone: s.timezone,
        gbp: s.gbpLocationName
          ? { locationName: s.gbpLocationName, connectedAt: s.gbpConnectedAt }
          : null,
        keywords: {
          total: counts?.total ?? 0,
          enabled: counts?.enabled ?? 0,
        },
        lastSyncedAt: s.lastSyncedAt,
      };
    }),
  });
}
