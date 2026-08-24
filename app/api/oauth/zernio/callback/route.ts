import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import {
  listGoogleBusinessLocations,
  selectGoogleBusinessLocation,
  listAccounts,
} from "@/lib/zernio";

/**
 * Return leg of the Zernio Google Business Profile connect flow.
 *
 * Google Business needs a secondary selection after OAuth: the account may manage several
 * locations, so the user picks which one this profile posts to. This handler lists them,
 * selects when told which, and then reports the Zernio accountId — the single id that
 * replaces GoHighLevel's locationId + accountId + userId triple.
 *
 *   GET /api/oauth/zernio/callback?profileId=...            -> list locations
 *   GET /api/oauth/zernio/callback?profileId=...&select=... -> select, then show accountId
 */

const html = (title: string, body: string, status = 200) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <style>
       body{font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.25rem;color:#111}
       h1{font-size:1.35rem;margin-bottom:.25rem}
       code{background:#f1f3f5;padding:.15rem .4rem;border-radius:4px;font-size:.9em}
       li{margin:.5rem 0}
       a.btn{display:inline-block;background:#111;color:#fff;text-decoration:none;padding:.5rem .9rem;border-radius:6px}
       .muted{color:#666;font-size:.9rem}
       pre{background:#f1f3f5;padding:1rem;border-radius:6px;overflow-x:auto;font-size:.85rem}
     </style>
     <h1>${title}</h1>${body}`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId");
  const select = url.searchParams.get("select");
  const label = url.searchParams.get("label") ?? "this client";
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return html(
      "Connection cancelled",
      `<p>Google returned <code>${oauthError}</code>. Nothing was connected.</p>`,
      400
    );
  }
  if (!profileId) {
    return html("Missing profileId", `<p>No Zernio profile was supplied.</p>`, 400);
  }

  try {
    if (select) {
      await selectGoogleBusinessLocation(profileId, select);
      const accounts = await listAccounts(profileId);
      const list = accounts?.accounts ?? accounts?.data ?? [];
      const gbp = (Array.isArray(list) ? list : []).find(
        (a: any) => a.platform === "googlebusiness"
      );
      const accountId = gbp?._id ?? gbp?.id ?? null;

      return html(
        "Connected",
        `<p><strong>${label}</strong> is connected to Google Business Profile.</p>
         <p>Zernio account id:</p><pre>${accountId ?? "not returned"}</pre>
         <p class="muted">Save this to the client's <code>client.json</code> under
         <code>zernio.accountId</code>. It replaces GoHighLevel's locationId, accountId and
         userId.</p>
         <pre>${JSON.stringify(gbp ?? list, null, 2)}</pre>`
      );
    }

    const locations = await listGoogleBusinessLocations(profileId);
    const items = locations?.locations ?? locations?.data ?? locations ?? [];

    if (!Array.isArray(items) || items.length === 0) {
      return html(
        "No locations found",
        `<p>Google returned no manageable locations for this account.</p>
         <p class="muted">The profile must be <em>verified</em>, and the Google account that
         authorized must have manager access to it.</p>
         <pre>${JSON.stringify(locations, null, 2)}</pre>`
      );
    }

    const rows = items
      .map((loc: any) => {
        const name = loc.name ?? loc.locationName ?? loc.location ?? "";
        const title = loc.title ?? loc.locationTitle ?? loc.displayName ?? name;
        const address = loc.address ?? loc.storefrontAddress ?? "";
        const href = `${getBaseUrl()}/api/oauth/zernio/callback?profileId=${encodeURIComponent(
          profileId
        )}&label=${encodeURIComponent(label)}&select=${encodeURIComponent(name)}`;
        return `<li><a class="btn" href="${href}">Use this</a> <strong>${title}</strong>
                <span class="muted">${typeof address === "string" ? address : ""}</span><br>
                <code>${name}</code></li>`;
      })
      .join("");

    return html(
      "Choose the location to connect",
      `<p>Authorized. Now pick which Google Business Profile location <strong>${label}</strong> should post to.</p>
       <ul>${rows}</ul>`
    );
  } catch (error) {
    return html(
      "Connection failed",
      `<p>${(error as Error).message}</p>`,
      502
    );
  }
}
