import { loadAnalyticsSite } from "@/lib/analytics/repo-context";
import { GbpConnectCard } from "@/components/analytics/gbp-connect-card";
import { ZernioGbpCard } from "@/components/integrations/zernio-gbp-card";
import type { AnalyticsSiteRow } from "@/lib/analytics/types";

export default async function IntegrationsPage(props: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await props.params;
  const site = (await loadAnalyticsSite(owner, repo)) as AnalyticsSiteRow | null;

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect the accounts this site publishes to and reports on. You can connect and
          disconnect these yourself — no need to send us credentials.
        </p>
      </div>
      <div className="space-y-4">
        <GbpConnectCard
          owner={owner}
          repo={repo}
          initialLocationName={site?.gbpLocationName ?? null}
          initialConnectedAt={site?.gbpConnectedAt ?? null}
        />
        {/* Zernio bills per connected account, so our own Google connection above is the
            one we offer. The Zernio card only stays for sites already connected there, so
            they can still disconnect. */}
        {site?.zernioAccountId && (
          <ZernioGbpCard
            owner={owner}
            repo={repo}
            initialLocationName={site.zernioLocationName ?? null}
            initialConnectedAt={site.zernioConnectedAt ?? null}
          />
        )}
      </div>
    </div>
  );
}
