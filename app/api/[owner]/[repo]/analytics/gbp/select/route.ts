import { NextResponse } from "next/server";
import { getRepoAnalyticsContext } from "@/lib/analytics/repo-context";
import {
  enumerateLocationsForSite,
  updateGbpLocationOnSite,
} from "@/lib/analytics/gbp";

type Params = { owner: string; repo: string };

export async function POST(
  request: Request,
  context: { params: Promise<Params> }
): Promise<Response> {
  const { owner, repo } = await context.params;
  try {
    const { site } = await getRepoAnalyticsContext({ owner, repo });
    if (!site) {
      return NextResponse.json({ status: "error", message: "Site not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { accountId?: string; locationId?: string }
      | null;
    if (!body?.accountId || !body?.locationId) {
      return NextResponse.json(
        { status: "error", message: "accountId and locationId are required" },
        { status: 400 }
      );
    }

    // Never trust the client's pair — re-enumerate from the stored refresh
    // token and confirm the chosen account+location actually belongs to it.
    const locations = await enumerateLocationsForSite(site.id);
    const match = locations.find(
      (l) => l.accountId === body.accountId && l.locationId === body.locationId
    );
    if (!match) {
      return NextResponse.json(
        { status: "error", message: "Selected location is not available on this account." },
        { status: 422 }
      );
    }

    await updateGbpLocationOnSite(
      site.id,
      match.accountId,
      match.locationId,
      match.locationName
    );

    return NextResponse.json({ status: "ok", location: match.locationName });
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? (error as { status?: number }).status ?? 500
        : 500;
    const message = error instanceof Error ? error.message : "Failed to select GBP location";
    return NextResponse.json({ status: "error", message }, { status });
  }
}
