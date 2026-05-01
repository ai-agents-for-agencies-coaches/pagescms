/**
 * Import existing local-rank heat-map JSONs from
 * `~/claude_work/local-seo-site-builder/heatmap-*.json` into the new
 * analytics_heatmap_run table — gives newly-tracked sites historical context
 * on day 1.
 *
 * Run:
 *   cd ~/claude_work/pagescms
 *   pnpm tsx --env-file=.env.local scripts/import-heatmap-jsons.ts <client-slug> <client-glob>
 *
 * Example (Terzo):
 *   pnpm tsx --env-file=.env.local scripts/import-heatmap-jsons.ts \
 *     geopopos/terzo-roofing-site \
 *     "$HOME/claude_work/local-seo-site-builder/heatmap-terzo-roofing-llc-*.json"
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  analyticsHeatmapRunTable,
  analyticsSiteKeywordTable,
  analyticsSiteTable,
} from "@/db/schema";

type LegacyTop3 = { name: string; rank: number; placeId?: string };
type LegacyCell = {
  row: number;
  col: number;
  lat: number;
  lng: number;
  position: number | null;
  top3?: LegacyTop3[];
};
type LegacyStats = {
  totalPoints: number;
  foundCount: number;
  notFoundCount?: number;
  visibility?: number;
  averageRank: number | null;
  top3Count?: number;
  top10Count?: number;
  apiAverageRank?: number | null;
  apiTop3Percent?: number;
};
type LegacyKeywordEntry = {
  keyword: string;
  gridSize: number;
  radiusMiles?: number;
  radiusKm?: number;
  centerLat: number;
  centerLng: number;
  grid: LegacyCell[];
  stats: LegacyStats;
};
type LegacyDoc = {
  businessName: string;
  scannedAt: string;
  source: string;
  gbpLookup: { name: string; placeId: string; lat: number; lng: number };
  keywords: Record<string, LegacyKeywordEntry>;
};

const dateFromFilename = (file: string): string | null => {
  const m = file.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const main = async () => {
  const target = process.argv[2];
  const dirArg = process.argv[3];
  const filenamePrefix = process.argv[4];
  if (!target || !dirArg || !filenamePrefix) {
    console.error("Usage: pnpm tsx scripts/import-heatmap-jsons.ts <owner/repo> <dir> <filename-prefix>");
    console.error("Example: ... geopopos/terzo-roofing-site ~/claude_work/local-seo-site-builder heatmap-terzo-roofing-llc-");
    process.exit(1);
  }
  const [owner, repo] = target.split("/");
  if (!owner || !repo) {
    console.error("First arg must be owner/repo");
    process.exit(1);
  }

  const [site] = await db
    .select({ id: analyticsSiteTable.id, gbpLocationId: analyticsSiteTable.gbpLocationId })
    .from(analyticsSiteTable)
    .where(and(eq(analyticsSiteTable.owner, owner), eq(analyticsSiteTable.repo, repo)));

  if (!site) {
    console.error(`No analytics_site for ${owner}/${repo}`);
    process.exit(1);
  }

  const expandedDir = dirArg.startsWith("~")
    ? path.join(process.env.HOME ?? "", dirArg.slice(1))
    : dirArg;
  const files = fs
    .readdirSync(expandedDir)
    .filter((f) => f.startsWith(filenamePrefix) && f.endsWith(".json"))
    .map((f) => path.join(expandedDir, f));
  if (files.length === 0) {
    console.error(`No files in ${expandedDir} matching ${filenamePrefix}*.json`);
    process.exit(1);
  }

  console.log(`Importing ${files.length} files for site_id=${site.id} (${owner}/${repo})`);

  for (const file of files.sort()) {
    const runDate = dateFromFilename(path.basename(file));
    if (!runDate) {
      console.log(`  skipping ${file} — no YYYY-MM-DD in filename`);
      continue;
    }
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as LegacyDoc;
    const placeId = doc.gbpLookup?.placeId ?? null;
    const lat = doc.gbpLookup?.lat != null ? String(doc.gbpLookup.lat) : null;
    const lng = doc.gbpLookup?.lng != null ? String(doc.gbpLookup.lng) : null;

    let inserted = 0;
    let updated = 0;
    for (const [, kwEntry] of Object.entries(doc.keywords)) {
      // Upsert the keyword row.
      const [kwRow] = await db
        .insert(analyticsSiteKeywordTable)
        .values({
          siteId: site.id,
          keyword: kwEntry.keyword,
          placeId,
          lat,
          lng,
          gridSize: kwEntry.gridSize,
          radius: kwEntry.radiusKm ?? Math.round((kwEntry.radiusMiles ?? 5) * 1.609),
          radiusUnits: "km",
          shape: "square",
          zoom: 13,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: [analyticsSiteKeywordTable.siteId, analyticsSiteKeywordTable.keyword],
          set: { updatedAt: new Date() },
        })
        .returning({ id: analyticsSiteKeywordTable.id });

      // Translate legacy stats → new summary shape.
      const totalPoints = kwEntry.stats.totalPoints ?? kwEntry.grid.length;
      const foundCount = kwEntry.stats.foundCount ?? 0;
      const foundPercent =
        kwEntry.stats.visibility != null
          ? kwEntry.stats.visibility * (kwEntry.stats.visibility <= 1 ? 100 : 1)
          : (foundCount / Math.max(1, totalPoints)) * 100;
      const top3Count = kwEntry.stats.top3Count ?? 0;
      const top3Percent =
        kwEntry.stats.apiTop3Percent != null
          ? kwEntry.stats.apiTop3Percent
          : (top3Count / Math.max(1, totalPoints)) * 100;

      // Penalty-based average — null cells count as rank 21 so the metric correctly
      // worsens with invisibility and improves as the business starts ranking.
      const NOT_FOUND_PENALTY = 21;
      const ranks = kwEntry.grid.map((c) => c.position ?? NOT_FOUND_PENALTY);
      const averageRank =
        ranks.length > 0 ? ranks.reduce((s, r) => s + r, 0) / ranks.length : null;

      const summary = {
        totalPoints,
        foundCount,
        foundPercent,
        averageRank,
        averageTotalRank: averageRank,
        top3Percent,
      };

      // Translate legacy grid cells → new cell shape.
      const grid = kwEntry.grid.map((c) => ({
        row: c.row,
        col: c.col,
        lat: c.lat,
        lng: c.lng,
        rank: c.position,
        top3: (c.top3 ?? []).slice(0, 3).map((t) => ({
          rank: t.rank,
          name: t.name,
          placeId: t.placeId ?? "",
        })),
      }));

      const result = await db
        .insert(analyticsHeatmapRunTable)
        .values({
          siteId: site.id,
          keywordId: kwRow.id,
          runDate,
          summary,
          grid,
          errorReason: null,
        })
        .onConflictDoUpdate({
          target: [
            analyticsHeatmapRunTable.siteId,
            analyticsHeatmapRunTable.keywordId,
            analyticsHeatmapRunTable.runDate,
          ],
          set: {
            summary,
            grid,
            errorReason: null,
            fetchedAt: new Date(),
          },
        })
        .returning({ id: analyticsHeatmapRunTable.id });

      if (result.length > 0) inserted++;
      else updated++;
    }

    console.log(`  ${path.basename(file)} (${runDate}): ${Object.keys(doc.keywords).length} keywords, ${inserted} inserted/updated`);
  }

  console.log("\nDone.");
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
