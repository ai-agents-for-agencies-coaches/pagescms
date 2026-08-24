import Link from "next/link";
import { asc } from "drizzle-orm";
import { ArrowLeft, Plug, Unplug } from "lucide-react";
import { MainRootLayout } from "../../main-root-layout";
import { requireAdminSession } from "@/lib/admin";
import { db } from "@/db";
import { analyticsSiteTable } from "@/db/schema";
import { DocumentTitle } from "@/components/document-title";
import { AdminTabs } from "@/components/admin-tabs";
import { AdminConfirmActionButton } from "@/components/admin-confirm-action-button";
import { disconnectZernioGbp } from "@/lib/actions/integrations";
import { ZERNIO_CONFIGURED } from "@/lib/zernio";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Site = typeof analyticsSiteTable.$inferSelect;

const formatDateTime = (value: Date | string | null | undefined) => {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

/**
 * The non-Zernio integrations are configured elsewhere (env, cron config, the analytics
 * admin APIs). They are read-only here on purpose: this tab answers "what is wired up for
 * this client", and only Google Business Profile is connected from inside it.
 */
const READ_ONLY_INTEGRATIONS: {
  label: string;
  value: (site: Site) => string | null;
}[] = [
  { label: "Search Console", value: (s) => s.gscProperty },
  { label: "Bing", value: (s) => s.bingSiteUrl },
  { label: "GA4", value: (s) => s.ga4PropertyId },
  { label: "Netlify", value: (s) => s.netlifySiteId },
  {
    label: "Call tracking",
    value: (s) =>
      s.callTrackingProvider
        ? `${s.callTrackingProvider}${
            s.callrailCompanyId || s.whatconvertsProfileId
              ? ` (${s.callrailCompanyId ?? s.whatconvertsProfileId})`
              : ""
          }`
        : null,
  },
  {
    label: "GBP (legacy OAuth)",
    value: (s) => s.gbpLocationName ?? s.gbpAccountId,
  },
];

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ connected?: string; error?: string }>;
}) {
  await requireAdminSession();
  const resolved = await searchParams;
  const connected = resolved?.connected?.trim();
  const connectError = resolved?.error?.trim();

  const sites = await db
    .select()
    .from(analyticsSiteTable)
    .orderBy(asc(analyticsSiteTable.owner), asc(analyticsSiteTable.repo));

  return (
    <MainRootLayout>
      <DocumentTitle title="Admin — Integrations" />
      <div className="max-w-screen-lg mx-auto p-4 md:p-6 space-y-6">
        <Link
          className={cn(
            buttonVariants({ variant: "outline", size: "xs" }),
            "inline-flex",
          )}
          href="/"
        >
          <ArrowLeft />
          Go home
        </Link>

        <header>
          <h1 className="font-semibold tracking-tight text-lg md:text-2xl">
            Admin
          </h1>
        </header>

        <AdminTabs current="integrations" />

        <div className="space-y-6">
          {connected ? (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
              Connected <strong>{connected}</strong> to Google Business Profile.
            </div>
          ) : null}
          {connectError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
              Connection failed: <code>{connectError}</code>
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Google Business Profile</CardTitle>
              <CardDescription>
                Connect a client&rsquo;s Google Business Profile through Zernio. The client
                authorizes their own Google account on Zernio&rsquo;s OAuth app, so there is no
                Google API approval to wait on and no per-client sub-account to provision.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!ZERNIO_CONFIGURED ? (
                <p className="text-sm text-muted-foreground">
                  <code>ZERNIO_API_KEY</code> is not set on this server, so connecting is
                  disabled.
                </p>
              ) : null}

              {sites.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No analytics sites yet. A site row is created per <code>owner/repo</code>{" "}
                  before its integrations can be connected.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Connected</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sites.map((site) => {
                      const isConnected = Boolean(site.zernioAccountId);
                      return (
                        <TableRow key={site.id}>
                          <TableCell className="font-medium">
                            {site.owner}/{site.repo}
                          </TableCell>
                          <TableCell>
                            {isConnected ? (
                              <Badge variant="default">Connected</Badge>
                            ) : (
                              <Badge variant="outline">Not connected</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {site.zernioLocationName ?? "-"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDateTime(site.zernioConnectedAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Link
                                href={`/api/oauth/zernio/start?siteId=${site.id}`}
                                className={cn(
                                  buttonVariants({ variant: "outline", size: "sm" }),
                                  !ZERNIO_CONFIGURED && "pointer-events-none opacity-50",
                                )}
                                aria-disabled={!ZERNIO_CONFIGURED}
                              >
                                <Plug />
                                {isConnected ? "Reconnect" : "Connect"}
                              </Link>
                              {isConnected ? (
                                <AdminConfirmActionButton
                                  action={disconnectZernioGbp.bind(null, site.id)}
                                  label="Disconnect"
                                  title="Disconnect Google Business Profile?"
                                  description={`This clears the saved connection for ${site.owner}/${site.repo}. The Zernio profile is kept, so reconnecting reuses it rather than creating a duplicate.`}
                                  confirmLabel="Disconnect"
                                  variant="outline"
                                  size="sm"
                                  icon={<Unplug />}
                                />
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Other integrations</CardTitle>
              <CardDescription>
                What each site is wired up to. These are configured outside this panel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sites.length === 0 ? (
                <p className="text-sm text-muted-foreground">No analytics sites yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      {READ_ONLY_INTEGRATIONS.map((integration) => (
                        <TableHead key={integration.label}>{integration.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sites.map((site) => (
                      <TableRow key={site.id}>
                        <TableCell className="font-medium">
                          {site.owner}/{site.repo}
                        </TableCell>
                        {READ_ONLY_INTEGRATIONS.map((integration) => {
                          const value = integration.value(site);
                          return (
                            <TableCell key={integration.label}>
                              {value ? (
                                <span
                                  className="text-sm text-foreground"
                                  title={value}
                                >
                                  {value.length > 28
                                    ? `${value.slice(0, 28)}…`
                                    : value}
                                </span>
                              ) : (
                                <span className="text-sm text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </MainRootLayout>
  );
}
