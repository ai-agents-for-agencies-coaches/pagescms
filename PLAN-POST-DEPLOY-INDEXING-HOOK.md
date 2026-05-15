# Plan: Post-Deploy Indexing Hook (GSC + Bing sitemap re-submit)

Fork: `geopopos/pagescms` • Stack already in place: Next.js App Router, Drizzle + Postgres,
Better Auth, Vercel envs holding the agency `GOOGLE_SERVICE_ACCOUNT_JSON_B64`,
`BING_WEBMASTER_API_KEY`, `NETLIFY_PAT`, and `CRON_SECRET`.

## Goal

When a Pages CMS edit (blog post, service-area page, any content) lands on a client site, the
client should not have to wait days for Google + Bing to notice. After every successful Netlify
deploy on any of our managed sites, automatically re-submit the sitemap to both engines so the
freshly-changed URLs get re-crawled within hours instead of days.

**Constraints:**
- Agency credentials (`GOOGLE_SERVICE_ACCOUNT_JSON_B64`, `BING_WEBMASTER_API_KEY`) must **never**
  live in client Netlify env vars — they grant cross-tenant access. They stay in the portal's
  Vercel env where they already are.
- New client onboarding should be a one-line addition (a single Netlify outgoing webhook URL),
  not a per-site credential push.
- IndexNow stays in the Netlify build plugin (keyless, per-URL, already in place). The portal
  webhook only handles the engines that require authenticated re-submission (GSC, Bing).

## Why this works without knowing "what changed"

Eleventy regenerates `sitemap.xml` on every build, with fresh `<lastmod>` tags on changed URLs.
Sitemap re-submission to GSC + Bing tells those engines "go re-read this sitemap" — they then
diff the `<lastmod>` timestamps against their own crawl cache and re-crawl only what actually
changed. The webhook stays brain-dead simple: it never needs a URL list.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Client edits a blog post in Pages CMS (cms.pageonelocal.com)             │
└──────────────────┬───────────────────────────────────────────────────────┘
                   │ GitHub App commit
                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Netlify build                                                            │
│  ├─ Eleventy regenerates sitemap.xml with fresh <lastmod>                 │
│  └─ netlify-plugin-indexnow fires per-URL pings to api.indexnow.org      │
│     (keyless — site key already in robots.txt)                            │
└──────────────────┬───────────────────────────────────────────────────────┘
                   │ Netlify "deploy-succeeded" outgoing webhook
                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  POST cms.pageonelocal.com/api/post-deploy-hook    ← NEW                  │
│  Body: Netlify deploy payload (site_id, deploy_id, deploy_ssl_url, …)    │
│  Header: X-Webhook-Signature (HMAC-SHA256 of body using NETLIFY_WEBHOOK_SECRET) │
└──────────────────┬───────────────────────────────────────────────────────┘
                   │
        ┌──────────┴───────────┐
        ▼                       ▼
   verify HMAC          lookup analytics_site by netlify_site_id
   (reject if invalid)   (404 if not enrolled — log and return)
                                ▼
                  ┌─────────────┴─────────────┐
                  ▼                            ▼
        ┌──────────────────┐        ┌──────────────────┐
        │ GSC submit_sitemap│        │ Bing submit_sitemap│
        │ (lib/analytics/   │        │ (lib/analytics/   │
        │  gsc.ts)          │        │  bing.ts)         │
        └────────┬─────────┘        └────────┬─────────┘
                 │                            │
                 └────────────┬───────────────┘
                              ▼
                ┌──────────────────────────────┐
                │  Log to indexing_ping table  │
                │  (audit + retry visibility)  │
                └──────────────────────────────┘
```

## What lives where

| Concern | Location | Already exists? |
|---|---|---|
| Per-URL pings to Bing/Yandex/DuckDuckGo/ChatGPT | `templates/eleventy/plugins/netlify-plugin-indexnow/` | ✅ in builder repo |
| Sitemap `<lastmod>` generation | `src/sitemap.njk` in each client site | ✅ scaffolded |
| Outgoing webhook on deploy | Netlify site notifications | ❌ one-time add per site |
| Webhook receiver | `app/api/post-deploy-hook/route.ts` | ❌ this plan |
| GSC `submit_sitemap` call | `lib/analytics/gsc.ts` (extend) | partially — has read methods, add submit |
| Bing `submit_sitemap` call | `lib/analytics/bing.ts` (extend) | partially — has read methods, add submit |
| Lookup table mapping Netlify site → GSC/Bing properties | `analytics_site` (`netlify_site_id` column) | ✅ table exists, column exists |
| Audit log of every ping | NEW table `indexing_ping` | ❌ this plan |

## New Drizzle table

```ts
// db/schema.ts
const indexingPingTable = pgTable("indexing_ping", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").notNull().references(() => analyticsSiteTable.id, { onDelete: "cascade" }),
  netlifyDeployId: text("netlify_deploy_id"),     // for de-dupe + traceability
  provider: text("provider").notNull(),            // "gsc" | "bing"
  sitemapUrl: text("sitemap_url").notNull(),
  status: text("status").notNull(),                // "success" | "error" | "skipped"
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => ({
  idx_indexing_ping_site_created: index("idx_indexing_ping_site_created").on(table.siteId, table.createdAt),
  idx_indexing_ping_deploy: index("idx_indexing_ping_deploy").on(table.netlifyDeployId),
}));
```

Use case: dashboard tab "Recent indexing pings" + automatic retry of failed ones from the daily
cron.

## New endpoint: `POST /api/post-deploy-hook`

```ts
// app/api/post-deploy-hook/route.ts (sketch)
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { analyticsSiteTable, indexingPingTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { submitSitemapToGsc } from "@/lib/analytics/gsc";
import { submitSitemapToBing } from "@/lib/analytics/bing";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-webhook-signature");
  const expected = crypto.createHmac("sha256", process.env.NETLIFY_WEBHOOK_SECRET!)
    .update(raw).digest("hex");
  if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(raw);
  const netlifySiteId = payload.site_id;
  const deployId = payload.id;
  const siteUrl = payload.ssl_url || payload.url; // canonical site URL from Netlify

  // Look up the site by Netlify ID
  const [site] = await db.select().from(analyticsSiteTable)
    .where(eq(analyticsSiteTable.netlifySiteId, netlifySiteId)).limit(1);
  if (!site) {
    // Not enrolled — silently accept (other sites may share the webhook URL pattern)
    return NextResponse.json({ ok: true, status: "site_not_enrolled" });
  }

  const sitemapUrl = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`;
  const results = await Promise.allSettled([
    site.gscProperty ? submitSitemapToGsc(site.gscProperty, sitemapUrl) : Promise.resolve({ skipped: true }),
    site.bingSiteUrl ? submitSitemapToBing(site.bingSiteUrl, sitemapUrl) : Promise.resolve({ skipped: true }),
  ]);

  // Persist audit rows for both providers
  await db.insert(indexingPingTable).values([
    buildPingRow(site.id, deployId, "gsc", sitemapUrl, results[0]),
    buildPingRow(site.id, deployId, "bing", sitemapUrl, results[1]),
  ]);

  return NextResponse.json({ ok: true, gsc: results[0].status, bing: results[1].status });
}
```

**Why HMAC vs. shared secret in query string:** Netlify's outgoing webhooks support an HMAC
signing scheme. We sign with `NETLIFY_WEBHOOK_SECRET` (new Vercel env var). Body is signed, so a
captured URL alone is useless.

## New library helpers

`lib/analytics/gsc.ts` — extend with:

```ts
export async function submitSitemapToGsc(siteUrl: string, sitemapUrl: string) {
  const auth = await getGoogleAuth(); // existing helper, reads GOOGLE_SERVICE_ACCOUNT_JSON_B64
  const sc = google.searchconsole({ version: "v1", auth });
  await sc.sitemaps.submit({
    siteUrl,
    feedpath: sitemapUrl,
  });
  return { ok: true };
}
```

`lib/analytics/bing.ts` — extend with:

```ts
export async function submitSitemapToBing(siteUrl: string, sitemapUrl: string) {
  const apiKey = process.env.BING_WEBMASTER_API_KEY!;
  const url = `https://ssl.bing.com/webmaster/api.svc/json/SubmitSitemap?apikey=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteUrl, feedUrl: sitemapUrl }),
  });
  if (!res.ok) throw new Error(`Bing ${res.status}: ${await res.text()}`);
  return { ok: true };
}
```

> Note: as of 2026-05-14 Bing's `AddSitemap` endpoint returns 404 via the MCP wrapper. Worth a
> direct curl smoke test from Vercel before relying on it — fallback is to use `submit_url_batch`
> with the sitemap URLs (less elegant but fewer surprises).

## New env vars

| Var | Where | Purpose |
|---|---|---|
| `NETLIFY_WEBHOOK_SECRET` | Vercel (portal env) | HMAC signing of outgoing Netlify webhooks |
| `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | Vercel (already set) | reused |
| `BING_WEBMASTER_API_KEY` | Vercel (already set) | reused |

## Per-site Netlify setup (one-time, one minute)

In each client's Netlify site dashboard:

1. **Site → Site configuration → Build & deploy → Deploy notifications**
2. **Add notification → Outgoing webhook**
3. **Event**: "Deploy succeeded"
4. **URL**: `https://cms.pageonelocal.com/api/post-deploy-hook`
5. **JWS secret**: paste the value of `NETLIFY_WEBHOOK_SECRET` (Netlify will use this to sign)

That's it. No new env vars on the client site. No agency credentials anywhere outside Vercel.

Can be scripted via Netlify API for bulk setup across the agency's existing sites — see
`netlify api createHook` (Netlify docs link in the API reference).

## Onboarding flow update

Bake the webhook creation into `utils/analytics/onboard.js` in the builder repo (which currently
creates the `analytics_site` row). Add a step that calls Netlify's `createHook` with the
outgoing-webhook config above, using the existing `NETLIFY_PAT` token.

That keeps "new client" a one-command setup.

## Testing plan

**Smoke test before promoting:**
1. Set up the webhook on `terzo-roofing-site` (lowest-risk traffic)
2. Trigger a no-op deploy (`netlify api createSiteBuildHook` or push a whitespace change)
3. Verify `indexing_ping` table records both `gsc=success` and `bing=success` rows
4. Confirm GSC dashboard shows a new "Last submitted" timestamp on the sitemap
5. Confirm Bing dashboard shows the same

**Failure paths to exercise:**
- Invalid HMAC signature → 401
- Netlify site_id not in `analytics_site` → 200 with `site_not_enrolled` (no error noise)
- Bing API returns 404/500 → row logged with status=error, request still returns 200 overall
  (don't fail the webhook on a single provider error)

**Rollout order:**
1. Terzo (production traffic but lowest risk — IndexNow already firing)
2. Allied (active client, post-launch indexing matters most)
3. Elite Painting, Acadiana Roof Restoration, the rest of the agency roster

## Why we're NOT using `inspect_url`

`inspect_url` is read-only — it returns indexing status, it does not request re-indexing.
Google's `urlNotifications.publish` ("Indexing API") IS write-capable but is restricted to
`JobPosting` and `BroadcastEvent` schema types. General blog posts aren't eligible. Sitemap
re-submission is the strongest programmatic Google nudge available.

If we ever need per-URL fresh status for the analytics dashboard, `inspect_url` can be called
from the daily sync cron — separate from this hook.

## Future enhancements (defer)

- **Retry queue**: if `indexing_ping` shows a `status=error` row, retry from a cron 1h later.
  Skip for v1 — both APIs are usually reliable.
- **Per-URL Bing batch**: also call `submit_url_batch` with new/changed URLs from the sitemap
  (parsing `<lastmod>`). Sitemap re-submission already covers this; only worth doing if Bing
  proves slow to honor sitemap re-submissions.
- **GA4 event**: emit a "indexing_pinged" event so the weekly digest can show "we pinged search
  engines about your N new pages this week".
- **Dashboard tab**: a "Crawl status" panel showing recent pings + last-crawl times from
  `inspect_url`.

## Open questions

1. Does Netlify's outgoing webhook HMAC use raw body or canonicalized? (Confirm against current
   Netlify docs before implementing the signature check — older docs said `X-Webhook-Signature`
   was a JWS, newer ones describe it differently.)
2. Should we also fire on `deploy-failed`? Probably no — failed builds don't change the live
   sitemap.
3. Quota concerns? GSC has no documented submit-sitemap limit. Bing's `submit_sitemap` is
   probably governed by the same daily quota as `submit_url` (10K/day on Terzo's account, 100/day
   on Allied's). Sitemap submission is much cheaper than URL submission — even hourly deploys
   wouldn't dent it.

## Estimated build time

Half a day to spec + ship + smoke-test on Terzo. Another half-day to bulk-enroll the agency
roster via scripted Netlify webhook creation.
