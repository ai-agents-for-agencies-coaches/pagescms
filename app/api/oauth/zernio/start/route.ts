import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { zernio, ZERNIO_CONFIGURED } from "@/lib/zernio";

/**
 * Start the Zernio-hosted Google Business Profile connect flow.
 *
 * Why this exists alongside /api/oauth/gbp: that route drives OUR OWN Google OAuth app,
 * which means every agency using this stack has to get their own Google Business Profile
 * API application approved. Zernio hosts the OAuth app, so the client clicks one button
 * and authorizes their own Google account, with no approval wait on our side.
 *
 *   GET /api/oauth/zernio/start?profileId=<zernio profile id>[&label=Terzo%20Roofing]
 *
 * The profileId is Zernio's per-client tenant. One profile per client, which lines up
 * with one row in clients/registry.jsonl.
 */
export async function GET(request: Request): Promise<Response> {
  if (!ZERNIO_CONFIGURED) {
    return NextResponse.json(
      { status: "error", message: "ZERNIO_API_KEY is not set on this server." },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId");
  const label = url.searchParams.get("label") ?? "";

  if (!profileId) {
    return NextResponse.json(
      { status: "error", message: "Missing profileId. Create one per client first." },
      { status: 400 }
    );
  }

  // Zernio sends the browser here once the client has authorized on Google.
  const redirectUrl = new URL(`${getBaseUrl()}/api/oauth/zernio/callback`);
  redirectUrl.searchParams.set("profileId", profileId);
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
