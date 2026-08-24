import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteTable } from "@/db/schema";
import { toErrorResponse } from "@/lib/api-error";
import { requireSiteForRepo } from "@/lib/zernio-connect";

/**
 * Forget this site's Zernio Google Business Profile connection.
 *
 * Clears our side only. The profile stays on Zernio with the account still attached, so
 * reconnecting reuses it rather than creating a duplicate — which is why zernioProfileId is
 * deliberately left in place.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const { owner, repo } = await context.params;
    const site = await requireSiteForRepo(owner, repo);

    await db
      .update(analyticsSiteTable)
      .set({
        zernioAccountId: null,
        zernioLocationName: null,
        zernioConnectedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(analyticsSiteTable.id, site.id));

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return toErrorResponse(error);
  }
}
