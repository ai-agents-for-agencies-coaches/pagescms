import { redirect } from "next/navigation";
import { loadAnalyticsSite } from "@/lib/analytics/repo-context";
import { enumerateLocationsForSite } from "@/lib/analytics/gbp";
import { GbpLocationPicker } from "@/components/analytics/gbp-location-picker";

/**
 * Shown when a connected Google account exposes more than one GBP location.
 * The OAuth callback persists the refresh token before enumerating, so this
 * page re-enumerates from that token (source of truth) and lets the client
 * pick the right account + location. Auth is enforced by the analytics layout.
 */
export default async function GbpSelectPage(props: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await props.params;
  const settings = `/${owner}/${repo}/analytics/settings`;

  const site = await loadAnalyticsSite(owner, repo);
  if (!site) redirect(`${settings}?gbp=error&reason=no_site`);

  let locations;
  try {
    locations = await enumerateLocationsForSite(site.id);
  } catch {
    // No stored refresh token / token revoked — send them back to reconnect.
    redirect(`${settings}?gbp=error&reason=not_connected`);
  }

  if (locations.length === 0) {
    redirect(`${settings}?gbp=error&reason=no_locations`);
  }
  if (locations.length === 1) {
    // Nothing to choose — bounce back so they can re-run the connect flow,
    // which will auto-pick the single location.
    redirect(`${settings}?gbp=error&reason=single_location_retry`);
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Choose a Business Profile location</h1>
        <p className="text-sm text-muted-foreground mt-1">
          This Google account manages more than one Business Profile location.
          Pick the one that belongs to <span className="font-medium">{repo}</span>.
        </p>
      </div>
      <GbpLocationPicker owner={owner} repo={repo} locations={locations} />
    </div>
  );
}
