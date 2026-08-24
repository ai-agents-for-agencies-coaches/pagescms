import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { toErrorResponse } from "@/lib/api-error";
import { zernio, ZERNIO_CONFIGURED, ZernioApiError } from "@/lib/zernio";
import { requireSiteForRepo, ensureZernioProfile } from "@/lib/zernio-connect";

/**
 * Start the Zernio-hosted Google Business Profile connect flow for one repo.
 *
 * Why this exists alongside /api/oauth/gbp: that route drives OUR OWN Google OAuth app,
 * which means every agency using this stack has to get their own Google Business Profile
 * API application approved. Zernio hosts the OAuth app, so the client clicks one button
 * and authorizes their own Google account, with no approval wait on our side.
 *
 *   GET /api/oauth/zernio/start?owner=<owner>&repo=<repo>
 *
 * Access is repo-scoped, not admin-scoped, so an invited client can connect and manage
 * their own profile. The Zernio profile is created on demand and remembered on the site.
 */
export async function GET(request: Request): Promise<Response> {
  if (!ZERNIO_CONFIGURED) {
    return NextResponse.json(
      { status: "error", message: "ZERNIO_API_KEY is not set on this server." },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");

  if (!owner || !repo) {
    return NextResponse.json(
      { status: "error", message: "Missing owner or repo." },
      { status: 400 }
    );
  }

  const back = `${getBaseUrl()}/${owner}/${repo}/integrations`;

  try {
    const site = await requireSiteForRepo(owner, repo);
    const profileId = await ensureZernioProfile(site);

    // Zernio sends the browser here once the client has authorized on Google.
    const redirectUrl = new URL(`${getBaseUrl()}/api/oauth/zernio/callback`);
    redirectUrl.searchParams.set("owner", owner);
    redirectUrl.searchParams.set("repo", repo);
    redirectUrl.searchParams.set("profileId", profileId);

    const data = await zernio("GET", "/connect/googlebusiness", {
      query: { profileId, redirect_url: redirectUrl.toString() },
    });

    const authUrl = data?.authUrl ?? data?.data?.authUrl;
    if (!authUrl) {
      return NextResponse.redirect(
        `${back}?zernio=error&reason=${encodeURIComponent("Zernio returned no authUrl")}`
      );
    }

    return NextResponse.redirect(authUrl);
  } catch (error) {
    // Auth failures should read as auth failures. A Zernio 401/403 is a different thing
    // entirely, so it must not be mistaken for the caller lacking access.
    const status = (error as { status?: number })?.status;
    if (!(error instanceof ZernioApiError) && (status === 401 || status === 403)) {
      return toErrorResponse(error);
    }

    return NextResponse.redirect(
      `${back}?zernio=error&reason=${encodeURIComponent((error as Error).message)}`
    );
  }
}
