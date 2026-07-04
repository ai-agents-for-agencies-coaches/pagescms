export const maxDuration = 30;

import { NextResponse } from "next/server";
import { getRepoAnalyticsContext } from "@/lib/analytics/repo-context";
import {
  getValidAccessToken,
  getLocationServiceInfo,
  getCategoryServiceTypes,
  setLocationServiceItems,
  mergeServiceItems,
  mapServiceNamesToItems,
} from "@/lib/analytics/gbp";
import { toErrorResponse } from "@/lib/api-error";

type Params = { owner: string; repo: string };

/**
 * Read-only view of a connected location's Google Business Profile services:
 * the current serviceItems plus the structured service types available for the
 * location's categories (so a future write path knows which structured items
 * are valid vs. which must fall back to free-form). No writes happen here.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<Params> },
) {
  try {
    const params = await context.params;
    const { site } = await getRepoAnalyticsContext(params);

    if (!site || !site.gbpLocationId) {
      return NextResponse.json({
        status: "ok",
        connected: false,
        location: null,
        serviceItems: [],
        categories: [],
      });
    }

    const accessToken = await getValidAccessToken(site.id);
    const info = await getLocationServiceInfo(accessToken, site.gbpLocationId);

    const categoryNames = [
      info.primaryCategory?.name,
      ...info.additionalCategories.map((c) => c.name),
    ].filter((n): n is string => Boolean(n));

    const categories = await getCategoryServiceTypes(
      accessToken,
      categoryNames,
      info.regionCode ?? "US",
    );

    return NextResponse.json({
      status: "ok",
      connected: true,
      location: site.gbpLocationName,
      title: info.title,
      regionCode: info.regionCode,
      serviceItems: info.serviceItems,
      primaryCategory: info.primaryCategory,
      additionalCategories: info.additionalCategories,
      categories,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Sync a list of service names to the location's GBP services.
 *
 * Body: { services: string[], apply?: boolean }
 *
 * Defaults to a DRY RUN — it maps the names, merges append-only with the
 * current list, and returns the diff without writing. Only when `apply: true`
 * is passed does it PATCH the live profile. The merge never removes existing
 * services, so a sync can only add.
 */
export async function POST(
  request: Request,
  context: { params: Promise<Params> },
) {
  try {
    const params = await context.params;
    const { site } = await getRepoAnalyticsContext(params);

    if (!site || !site.gbpLocationId) {
      return NextResponse.json(
        { status: "error", message: "Site is not connected to a GBP location." },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { services?: unknown; apply?: unknown }
      | null;
    const services = Array.isArray(body?.services)
      ? body.services.filter((s): s is string => typeof s === "string")
      : [];
    if (services.length === 0) {
      return NextResponse.json(
        { status: "error", message: "`services` must be a non-empty array of names." },
        { status: 400 },
      );
    }
    const apply = body?.apply === true;

    const accessToken = await getValidAccessToken(site.id);
    const info = await getLocationServiceInfo(accessToken, site.gbpLocationId);

    const categoryNames = [
      info.primaryCategory?.name,
      ...info.additionalCategories.map((c) => c.name),
    ].filter((n): n is string => Boolean(n));
    const categories = await getCategoryServiceTypes(
      accessToken,
      categoryNames,
      info.regionCode ?? "US",
    );

    const mapped = mapServiceNamesToItems(
      services,
      categories,
      info.primaryCategory?.name ?? null,
    );
    const { merged, added, unchanged } = mergeServiceItems(
      info.serviceItems,
      mapped.items,
    );

    const diff = {
      location: site.gbpLocationName,
      current: info.serviceItems,
      added,
      unchanged,
      unmapped: mapped.unmapped,
      structuredCount: mapped.structuredCount,
      freeFormCount: mapped.freeFormCount,
    };

    if (!apply) {
      return NextResponse.json({ status: "ok", dryRun: true, ...diff });
    }

    // Nothing new to add — skip the PATCH (and the moderation it can trigger).
    if (added.length === 0) {
      return NextResponse.json({
        status: "ok",
        dryRun: false,
        applied: 0,
        ...diff,
        serviceItems: info.serviceItems,
      });
    }

    const updated = await setLocationServiceItems(
      accessToken,
      site.gbpLocationId,
      merged,
    );

    return NextResponse.json({
      status: "ok",
      dryRun: false,
      applied: added.length,
      ...diff,
      serviceItems: updated.serviceItems,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
