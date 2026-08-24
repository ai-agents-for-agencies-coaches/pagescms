"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteTable } from "@/db/schema";
import { requireAdminSession } from "@/lib/admin";

/**
 * Forget a site's Zernio Google Business Profile connection.
 *
 * This clears our side only. The profile stays on Zernio with the account still attached, so
 * reconnecting the same site reuses the profile rather than creating a duplicate — which is
 * why zernioProfileId is deliberately left in place.
 */
const disconnectZernioGbp = async (siteId: number) => {
  await requireAdminSession();

  await db
    .update(analyticsSiteTable)
    .set({
      zernioAccountId: null,
      zernioLocationName: null,
      zernioConnectedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(analyticsSiteTable.id, siteId));

  revalidatePath("/admin/integrations");

  return { success: true };
};

export { disconnectZernioGbp };
