import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteTable } from "@/db/schema";
import { getRepoAnalyticsContext } from "@/lib/analytics/repo-context";
import { createProfile } from "@/lib/zernio";

/**
 * Authorize a repo-scoped Zernio action and give back the site row to write to.
 *
 * The gate is deliberately the same one Analytics uses, not the installation-wide admin
 * check: a client we invite as a collaborator has no GitHub identity of their own, but does
 * have access to their repo, and managing their own Google Business Profile connection is
 * exactly the kind of thing they should be able to do without us.
 *
 * The site row is created on demand because a client can reach Integrations before anyone
 * has saved analytics settings for them.
 */
export const requireSiteForRepo = async (owner: string, repo: string) => {
  const { site } = await getRepoAnalyticsContext({ owner, repo });
  if (site) return site;

  const normalizedOwner = owner.toLowerCase();
  const normalizedRepo = repo.toLowerCase();

  const inserted = await db
    .insert(analyticsSiteTable)
    .values({ owner: normalizedOwner, repo: normalizedRepo })
    .onConflictDoNothing({
      target: [analyticsSiteTable.owner, analyticsSiteTable.repo],
    })
    .returning();

  if (inserted.length > 0) return inserted[0];

  // Lost the race with a concurrent insert — read back the winner.
  const [existing] = await db
    .select()
    .from(analyticsSiteTable)
    .where(
      and(
        eq(analyticsSiteTable.owner, normalizedOwner),
        eq(analyticsSiteTable.repo, normalizedRepo),
      ),
    )
    .limit(1);

  return existing;
};

/** One Zernio profile per client, created the first time they connect and remembered after. */
export const ensureZernioProfile = async (site: {
  id: number;
  owner: string;
  repo: string;
  zernioProfileId: string | null;
}) => {
  if (site.zernioProfileId) return site.zernioProfileId;

  const profileId = await createProfile(`${site.owner}/${site.repo}`);
  await db
    .update(analyticsSiteTable)
    .set({ zernioProfileId: profileId, updatedAt: new Date() })
    .where(eq(analyticsSiteTable.id, site.id));

  return profileId;
};
