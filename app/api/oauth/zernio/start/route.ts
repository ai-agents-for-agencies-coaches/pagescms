import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteTable } from "@/db/schema";
import { getBaseUrl } from "@/lib/base-url";
import { requireAdminSession } from "@/lib/admin";
import { zernio, ZERNIO_CONFIGURED, createProfile } from "@/lib/zernio";

/**
 * Start the Zernio-hosted Google Business Profile connect flow.
 *
 * Why this exists alongside /api/oauth/gbp: that route drives OUR OWN Google OAuth app,
 * which means every agency using this stack has to get their own Google Business Profile
 * API application approved. Zernio hosts the OAuth app, so the client clicks one button
 * and authorizes their own Google account, with no approval wait on our side.
 *
 *   GET /api/oauth/zernio/start?siteId=<analytics_site id>   <- what the Admin tab uses
 *   GET /api/oauth/zernio/start?profileId=<zernio profile id>[&label=...]
 *
 * The siteId form is the one to prefer: it creates the client's Zernio profile on demand and
 * remembers it, so the connection can be written back to the site when the callback returns.
 * The bare profileId form is kept because it is what the manual connect URL uses, and it
 * still works for a client that has no analytics_site row yet.
 */
export async function GET(request: Request): Promise<Response> {
  // This route now writes to the database, so it must not stay open to anonymous callers.
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Admin access required." },
      { status: 403 }
    );
  }

  if (!ZERNIO_CONFIGURED) {
    return NextResponse.json(
      { status: "error", message: "ZERNIO_API_KEY is not set on this server." },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const siteIdParam = url.searchParams.get("siteId");
  let profileId = url.searchParams.get("profileId");
  let label = url.searchParams.get("label") ?? "";
  let siteId: number | null = null;

  if (siteIdParam) {
    const parsed = Number.parseInt(siteIdParam, 10);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json(
        { status: "error", message: "siteId must be a number." },
        { status: 400 }
      );
    }
    siteId = parsed;

    const [site] = await db
      .select()
      .from(analyticsSiteTable)
      .where(eq(analyticsSiteTable.id, siteId))
      .limit(1);

    if (!site) {
      return NextResponse.json(
        { status: "error", message: `No analytics site with id ${siteId}.` },
        { status: 404 }
      );
    }

    label = label || `${site.owner}/${site.repo}`;

    // One Zernio profile per client, created the first time they connect anything.
    profileId = site.zernioProfileId;
    if (!profileId) {
      try {
        profileId = await createProfile(label);
      } catch (error) {
        return NextResponse.json(
          { status: "error", message: (error as Error).message },
          { status: 502 }
        );
      }
      await db
        .update(analyticsSiteTable)
        .set({ zernioProfileId: profileId, updatedAt: new Date() })
        .where(eq(analyticsSiteTable.id, siteId));
    }
  }

  if (!profileId) {
    return NextResponse.json(
      { status: "error", message: "Missing profileId. Create one per client first." },
      { status: 400 }
    );
  }

  // Zernio sends the browser here once the client has authorized on Google.
  const redirectUrl = new URL(`${getBaseUrl()}/api/oauth/zernio/callback`);
  redirectUrl.searchParams.set("profileId", profileId);
  if (siteId !== null) redirectUrl.searchParams.set("siteId", String(siteId));
  if (label) redirectUrl.searchParams.set("label", label);

  try {
    const data = await zernio("GET", "/connect/googlebusiness", {
      query: { profileId, redirect_url: redirectUrl.toString() },
    });

    const authUrl = data?.authUrl ?? data?.data?.authUrl;
    if (!authUrl) {
      return NextResponse.json(
        { status: "error", message: "Zernio did not return an authUrl", detail: data },
        { status: 502 }
      );
    }

    return NextResponse.redirect(authUrl);
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: (error as Error).message },
      { status: 502 }
    );
  }
}
