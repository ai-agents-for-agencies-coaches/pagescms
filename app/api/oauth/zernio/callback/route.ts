import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteTable } from "@/db/schema";
import { getBaseUrl } from "@/lib/base-url";
import { toErrorResponse } from "@/lib/api-error";
import { requireSiteForRepo } from "@/lib/zernio-connect";
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
 * therefore just: read the connected account off the profile, write it to the site, and send
 * the user back to their Integrations page.
 *
 * Zernio can still hand back `step=select_location` with a token when it wants US to render
 * the picker. That branch is kept so the flow does not dead-end, and it posts the shape the
 * API actually documents: a bare `locationId` plus the `pendingDataToken` from the redirect.
 * An earlier version posted `locationName`, which the API rejects.
 */

/** This page interpolates query params, so everything untrusted goes through here. */
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

const pickerPage = (title: string, body: string, status = 200) =>
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
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  const select = url.searchParams.get("select");
  const oauthError = url.searchParams.get("error");

  // Zernio hands these back when it wants us to render the picker.
  const pendingDataToken = url.searchParams.get("pendingDataToken") ?? undefined;
  const tempToken = url.searchParams.get("tempToken") ?? undefined;

  if (!owner || !repo) {
    return NextResponse.json(
      { status: "error", message: "Missing owner or repo." },
      { status: 400 }
    );
  }

  const back = `${getBaseUrl()}/${owner}/${repo}/integrations`;
  const fail = (reason: string) =>
    NextResponse.redirect(`${back}?zernio=error&reason=${encodeURIComponent(reason)}`);

  if (oauthError) return fail(oauthError);

  try {
    const site = await requireSiteForRepo(owner, repo);
    const profileId = site.zernioProfileId;
    if (!profileId) return fail("not_started");

    if (select) {
      await selectGoogleBusinessLocation({
        profileId,
        locationId: select,
        pendingDataToken,
      });
    }

    const account = await findGoogleBusinessAccount(profileId);

    if (account) {
      const accountId = account?._id ?? account?.id ?? account?.accountId ?? null;
      if (!accountId) return fail("no_account_id");

      const locationName =
        account?.selectedLocationName ??
        account?.displayName ??
        account?.username ??
        null;

      await db
        .update(analyticsSiteTable)
        .set({
          zernioAccountId: String(accountId),
          zernioLocationName: locationName,
          zernioConnectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(analyticsSiteTable.id, site.id));

      return NextResponse.redirect(
        `${back}?zernio=success&location=${encodeURIComponent(locationName ?? "your location")}`
      );
    }

    // No account yet: Zernio wants us to pick the location.
    const locations = await listGoogleBusinessLocations(profileId, {
      pendingDataToken,
      tempToken,
    });
    const items = locations?.locations ?? locations?.data ?? locations ?? [];

    if (!Array.isArray(items) || items.length === 0) return fail("no_locations");

    const rows = items
      .map((loc: any) => {
        // `id` is the location id the select endpoint wants. `name` is the BUSINESS name.
        const locationId = loc.id ?? loc.locationId ?? "";
        const title = loc.name ?? loc.title ?? locationId;
        const address = typeof loc.address === "string" ? loc.address : "";
        const href = new URL(`${getBaseUrl()}/api/oauth/zernio/callback`);
        href.searchParams.set("owner", owner);
        href.searchParams.set("repo", repo);
        href.searchParams.set("select", locationId);
        if (pendingDataToken) href.searchParams.set("pendingDataToken", pendingDataToken);
        if (tempToken) href.searchParams.set("tempToken", tempToken);
        return `<li><a class="btn" href="${esc(href.toString())}">Use this</a> <strong>${esc(title)}</strong>
                <span class="muted">${esc(address)}</span><br>
                <code>${esc(locationId)}</code></li>`;
      })
      .join("");

    return pickerPage(
      "Choose the location to connect",
      `<p>Authorized. Now pick which Google Business Profile location
       <strong>${esc(`${owner}/${repo}`)}</strong> should use.</p>
       <ul>${rows}</ul>`
    );
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 401 || status === 403) return toErrorResponse(error);
    return fail((error as Error).message);
  }
}
