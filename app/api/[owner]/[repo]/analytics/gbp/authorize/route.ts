import { NextResponse } from "next/server";
import { getRepoAnalyticsContext } from "@/lib/analytics/repo-context";
import { buildAuthState, buildAuthUrl } from "@/lib/analytics/gbp";
import { requireSiteForRepo } from "@/lib/zernio-connect";

type Params = { owner: string; repo: string };

export async function GET(
  _request: Request,
  context: { params: Promise<Params> }
): Promise<Response> {
  const { owner, repo } = await context.params;
  try {
    const { user } = await getRepoAnalyticsContext({ owner, repo });
    // Integrations can be reached before anyone has saved analytics settings.
    await requireSiteForRepo(owner, repo);

    const state = await buildAuthState({ owner, repo, userId: user.id });
    const url = buildAuthUrl(state);
    return NextResponse.redirect(url);
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? (error as { status?: number }).status ?? 500
        : 500;
    const message = error instanceof Error ? error.message : "Failed to initiate GBP OAuth";
    return NextResponse.json({ status: "error", message }, { status });
  }
}
