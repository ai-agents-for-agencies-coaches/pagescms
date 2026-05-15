import crypto from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsSiteTable, indexingPingTable } from "@/db/schema";
import { submitSitemapToGsc } from "@/lib/analytics/gsc";
import { submitSitemapToBing } from "@/lib/analytics/bing";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Netlify "deploy-succeeded" outgoing webhook receiver.
 *
 * Verifies the X-Webhook-Signature JWS (HS256 with iss=netlify and
 * sha256=hex(body), signed with NETLIFY_WEBHOOK_SECRET), looks up the
 * analytics_site by netlify_site_id, and re-submits the site's sitemap to
 * Google Search Console + Bing Webmaster Tools. Persists one indexing_ping
 * row per provider for audit/retry visibility.
 *
 * Always returns 200 when the signature is valid — a single failing provider
 * shouldn't bounce the webhook (Netlify will keep retrying otherwise).
 */

const base64UrlDecode = (input: string): Buffer => {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
};

type NetlifyJwsClaims = { iss?: string; sha256?: string };

/**
 * Verify the JWS in X-Webhook-Signature.
 *
 * Returns the decoded claims on success, or null if anything is off
 * (wrong algorithm, bad signature, missing/invalid claims, body hash
 * mismatch). The body hash check is what binds the signature to the
 * actual payload — a replayed signature with a different body fails here.
 */
const verifyNetlifyJws = (
  token: string,
  secret: string,
  body: string,
): NetlifyJwsClaims | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  let payload: NetlifyJwsClaims;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = base64UrlDecode(signatureB64);
  if (expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(expected, actual)) return null;

  if (payload.iss !== "netlify") return null;
  if (!payload.sha256) return null;

  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const claimHash = Buffer.from(payload.sha256, "hex");
  const computed = Buffer.from(bodyHash, "hex");
  if (claimHash.length !== computed.length) return null;
  if (!crypto.timingSafeEqual(claimHash, computed)) return null;

  return payload;
};

type Provider = "gsc" | "bing";

type ProviderOutcome =
  | { status: "success"; durationMs: number }
  | { status: "skipped"; durationMs: number }
  | { status: "error"; durationMs: number; errorMessage: string };

const submit = async (
  provider: Provider,
  fn: (() => Promise<void>) | null,
): Promise<ProviderOutcome> => {
  const start = Date.now();
  if (!fn) return { status: "skipped", durationMs: 0 };
  try {
    await fn();
    return { status: "success", durationMs: Date.now() - start };
  } catch (error) {
    const message = error instanceof Error ? error.message : `unknown ${provider} error`;
    return {
      status: "error",
      durationMs: Date.now() - start,
      errorMessage: message.slice(0, 500),
    };
  }
};

export async function POST(request: NextRequest) {
  const secret = process.env.NETLIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("post-deploy-hook: NETLIFY_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get("x-webhook-signature");
  if (!signature || !verifyNetlifyJws(signature, secret, body)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: {
    id?: string;
    site_id?: string;
    ssl_url?: string;
    url?: string;
    state?: string;
  };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const netlifySiteId = payload.site_id;
  const deployId = payload.id ?? null;
  const siteUrl = payload.ssl_url || payload.url;
  if (!netlifySiteId || !siteUrl) {
    return NextResponse.json({ ok: true, status: "missing_fields" });
  }

  const [site] = await db
    .select()
    .from(analyticsSiteTable)
    .where(eq(analyticsSiteTable.netlifySiteId, netlifySiteId))
    .limit(1);
  if (!site) {
    return NextResponse.json({ ok: true, status: "site_not_enrolled" });
  }

  const sitemapUrl = `${siteUrl.replace(/\/+$/, "")}/sitemap.xml`;

  const [gsc, bing] = await Promise.all([
    submit("gsc", site.gscProperty ? () => submitSitemapToGsc(site.gscProperty!, sitemapUrl) : null),
    submit("bing", site.bingSiteUrl ? () => submitSitemapToBing(site.bingSiteUrl!, sitemapUrl) : null),
  ]);

  const toRow = (provider: Provider, outcome: ProviderOutcome) => ({
    siteId: site.id,
    netlifyDeployId: deployId,
    provider,
    sitemapUrl,
    status: outcome.status,
    errorMessage: outcome.status === "error" ? outcome.errorMessage : null,
    durationMs: outcome.durationMs,
  });

  try {
    await db.insert(indexingPingTable).values([toRow("gsc", gsc), toRow("bing", bing)]);
  } catch (error) {
    console.error("post-deploy-hook: failed to persist indexing_ping rows", error);
  }

  return NextResponse.json({
    ok: true,
    siteId: site.id,
    deployId,
    sitemapUrl,
    gsc: { status: gsc.status, durationMs: gsc.durationMs },
    bing: { status: bing.status, durationMs: bing.durationMs },
  });
}
