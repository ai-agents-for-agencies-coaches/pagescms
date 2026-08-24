import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteTable } from "@/db/schema";
import { getBaseUrl } from "@/lib/base-url";
import { requireAdminSession } from "@/lib/admin";
import {
  listGoogleBusinessLocations,
  selectGoogleBusinessLocation,
  findGoogleBusinessAccount,
} from "@/lib/zernio";

/**
 * Return leg of the Zernio Google Business Profile connect flow.
 *
 * The start route does NOT ask for headless mode, so Zernio hosts the location picker itself
 * and the account already exists by the time the browser lands here. The normal path is
 * therefore just: read the connected account off the profile and write it to the site.
 *
 * Zernio can still hand back `step=select_location` with a token when it wants US to render
 * the picker. That branch is kept so the flow does not dead-end, and it now posts the shape
 * the API actually documents: a bare `locationId` plus the `pendingDataToken` from the
 * redirect. The previous version posted `locationName`, which the API rejects.
 *
 *   GET /api/oauth/zernio/callback?profileId=...&siteId=...
 *   GET /api/oauth/zernio/callback?profileId=...&select=<locationId>   (picker branch)
 */

/** These pages interpolate query params, so everything untrusted goes through here. */
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );

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

/** Write the connected account back to the site, so nobody has to copy an id by hand. */
const persist = async (siteId: number, account: any) => {
  const accountId = account?._id ?? account?.id ?? account?.accountId ?? null;
  if (!accountId) return null;

  await db
    .update(analyticsSiteTable)
    .set({
      zernioAccountId: String(accountId),
      zernioLocationName:
        account?.selectedLocationName ??
        account?.displayName ??
        account?.username ??
        null,
      zernioConnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(analyticsSiteTable.id, siteId));

  return String(accountId);
};

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminSession();
  } catch {
    return html("Admin access required", `<p>Sign in as an admin and try again.</p>`, 403);
  }

  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId");
  const select = url.searchParams.get("select");
  const label = url.searchParams.get("label") ?? "this client";
  const oauthError = url.searchParams.get("error");
  const siteIdParam = url.searchParams.get("siteId");
  const siteId = siteIdParam ? Number.parseInt(siteIdParam, 10) : NaN;
  const hasSite = Number.isFinite(siteId);

  // Zernio hands these back when it wants us to render the picker.
  const pendingDataToken = url.searchParams.get("pendingDataToken") ?? undefined;
  const tempToken = url.searchParams.get("tempToken") ?? undefined;

  const backToAdmin = `${getBaseUrl()}/admin/integrations`;

  if (oauthError) {
    if (hasSite) {
      return NextResponse.redirect(
        `${backToAdmin}?error=${encodeURIComponent(oauthError)}`
      );
    }
    return html(
      "Connection cancelled",
      `<p>Google returned <code>${esc(oauthError)}</code>. Nothing was connected.</p>`,
      400
    );
  }
  if (!profileId) {
    return html("Missing profileId", `<p>No Zernio profile was supplied.</p>`, 400);
  }

  try {
    if (select) {
      await selectGoogleBusinessLocation({
        profileId,
        locationId: select,
        pendingDataToken,
      });
    }

    const account = await findGoogleBusinessAccount(profileId);

    if (account) {
      const accountId = hasSite ? await persist(siteId, account) : null;

      if (hasSite) {
        return NextResponse.redirect(
          `${backToAdmin}?connected=${encodeURIComponent(label)}`
        );
      }

      const rawId = accountId ?? account?._id ?? account?.id ?? "not returned";
      return html(
        "Connected",
        `<p><strong>${esc(label)}</strong> is connected to Google Business Profile.</p>
         <p>Zernio account id:</p><pre>${esc(rawId)}</pre>
         <p class="muted">This connection was not attached to a site because no
         <code>siteId</code> was supplied. Connect from
         <a href="${backToAdmin}">Admin &rarr; Integrations</a> to have it saved automatically.</p>
         <pre>${esc(JSON.stringify(account, null, 2))}</pre>`
      );
    }

    // No account yet: Zernio wants us to pick the location.
    const locations = await listGoogleBusinessLocations(profileId, {
      pendingDataToken,
      tempToken,
    });
    const items = locations?.locations ?? locations?.data ?? locations ?? [];

    if (!Array.isArray(items) || items.length === 0) {
      return html(
        "No locations found",
        `<p>Google returned no manageable locations for this account.</p>
         <p class="muted">The profile must be <em>verified</em>, and the Google account that
         authorized must have manager access to it.</p>
         <pre>${esc(JSON.stringify(locations, null, 2))}</pre>`
      );
    }

    const rows = items
      .map((loc: any) => {
        // `id` is the location id the select endpoint wants. `name` is the BUSINESS name.
        const locationId = loc.id ?? loc.locationId ?? "";
        const title = loc.name ?? loc.title ?? locationId;
        const address = typeof loc.address === "string" ? loc.address : "";
        const href = new URL(`${getBaseUrl()}/api/oauth/zernio/callback`);
        href.searchParams.set("profileId", profileId);
        href.searchParams.set("label", label);
        href.searchParams.set("select", locationId);
        if (hasSite) href.searchParams.set("siteId", String(siteId));
        if (pendingDataToken) href.searchParams.set("pendingDataToken", pendingDataToken);
        if (tempToken) href.searchParams.set("tempToken", tempToken);
        return `<li><a class="btn" href="${esc(href.toString())}">Use this</a> <strong>${esc(title)}</strong>
                <span class="muted">${esc(address)}</span><br>
                <code>${esc(locationId)}</code></li>`;
      })
      .join("");

    return html(
      "Choose the location to connect",
      `<p>Authorized. Now pick which Google Business Profile location <strong>${esc(label)}</strong> should post to.</p>
       <ul>${rows}</ul>`
    );
  } catch (error) {
    return html("Connection failed", `<p>${esc((error as Error).message)}</p>`, 502);
  }
}
