import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyticsCredentialTable, analyticsSiteTable } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { getBaseUrl } from "@/lib/base-url";
import type { GbpMetrics } from "./types";

const GBP_PROVIDER_KEY = "gbp_oauth";
const GBP_SCOPES = ["https://www.googleapis.com/auth/business.manage"];
const STATE_TTL_SEC = 300;

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
};

const getOAuthConfig = () => ({
  clientId: requireEnv("GBP_OAUTH_CLIENT_ID"),
  clientSecret: requireEnv("GBP_OAUTH_CLIENT_SECRET"),
  redirectUri: `${getBaseUrl()}/api/oauth/gbp/callback`,
});

type StatePayload = {
  owner: string;
  repo: string;
  userId: string;
  exp: number;
};

const buildAuthState = async (payload: Omit<StatePayload, "exp">): Promise<string> => {
  const fullPayload: StatePayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC,
  };
  const { ciphertext, iv } = await encrypt(JSON.stringify(fullPayload));
  return Buffer.from(JSON.stringify({ c: ciphertext, i: iv })).toString("base64url");
};

const verifyAuthState = async (state: string): Promise<StatePayload> => {
  let parsed: { c: string; i: string };
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid state format");
  }
  const json = await decrypt(parsed.c, parsed.i);
  const payload = JSON.parse(json) as StatePayload;
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error("OAuth state expired — please retry the connection.");
  }
  return payload;
};

const buildAuthUrl = (state: string): string => {
  const cfg = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GBP_SCOPES.join(" "),
    access_type: "offline",
    // select_account lets the client pick the correct Google account when they
    // are signed into several; consent forces a refresh_token to be returned.
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
};

const exchangeCodeForTokens = async (code: string): Promise<TokenResponse> => {
  const cfg = getOAuthConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
};

const refreshAccessToken = async (refreshToken: string): Promise<TokenResponse> => {
  const cfg = getOAuthConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Refresh token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
};

type GbpAccount = { name: string; accountName?: string; type?: string };
type GbpLocation = { name: string; title?: string; storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string } };

const listAccounts = async (accessToken: string): Promise<GbpAccount[]> => {
  const res = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`listAccounts failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { accounts?: GbpAccount[] };
  return json.accounts ?? [];
};

const listLocations = async (accessToken: string, accountName: string): Promise<GbpLocation[]> => {
  const url = new URL(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`
  );
  url.searchParams.set("readMask", "name,title,storefrontAddress");
  url.searchParams.set("pageSize", "100");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`listLocations failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { locations?: GbpLocation[] };
  return json.locations ?? [];
};

type EnumeratedLocation = {
  accountId: string;
  accountName: string;
  locationId: string;
  locationName: string;
  address: string | null;
};

const formatAddress = (loc: GbpLocation): string | null => {
  const a = loc.storefrontAddress;
  if (!a) return null;
  const parts = [
    ...(a.addressLines ?? []),
    [a.locality, a.administrativeArea].filter(Boolean).join(", "),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

const enumerateAllLocations = async (accessToken: string): Promise<EnumeratedLocation[]> => {
  const accounts = await listAccounts(accessToken);
  const out: EnumeratedLocation[] = [];
  for (const acc of accounts) {
    const locations = await listLocations(accessToken, acc.name);
    for (const loc of locations) {
      out.push({
        accountId: acc.name,
        accountName: acc.accountName || acc.name,
        locationId: loc.name,
        locationName: loc.title || loc.name,
        address: formatAddress(loc),
      });
    }
  }
  return out;
};

/**
 * Re-enumerate locations using the refresh token already stored for a site.
 * Used by the location picker (callback persists the refresh token before
 * enumeration, so the picker is the source of truth — no candidate list is
 * stuffed into URL/state).
 */
const enumerateLocationsForSite = async (siteId: number): Promise<EnumeratedLocation[]> => {
  const accessToken = await getValidAccessToken(siteId);
  return enumerateAllLocations(accessToken);
};

const storeRefreshToken = async (siteId: number, refreshToken: string): Promise<void> => {
  const { ciphertext, iv } = await encrypt(refreshToken);
  await db
    .insert(analyticsCredentialTable)
    .values({ siteId, provider: GBP_PROVIDER_KEY, ciphertext, iv })
    .onConflictDoUpdate({
      target: [analyticsCredentialTable.siteId, analyticsCredentialTable.provider],
      set: { ciphertext, iv, updatedAt: new Date() },
    });
};

const loadRefreshToken = async (siteId: number): Promise<string | null> => {
  const rows = await db
    .select()
    .from(analyticsCredentialTable)
    .where(
      and(
        eq(analyticsCredentialTable.siteId, siteId),
        eq(analyticsCredentialTable.provider, GBP_PROVIDER_KEY)
      )
    )
    .limit(1);
  if (rows.length === 0) return null;
  return decrypt(rows[0].ciphertext, rows[0].iv);
};

const deleteRefreshToken = async (siteId: number): Promise<void> => {
  await db
    .delete(analyticsCredentialTable)
    .where(
      and(
        eq(analyticsCredentialTable.siteId, siteId),
        eq(analyticsCredentialTable.provider, GBP_PROVIDER_KEY)
      )
    );
};

const updateGbpLocationOnSite = async (
  siteId: number,
  accountId: string,
  locationId: string,
  locationName: string
): Promise<void> => {
  await db
    .update(analyticsSiteTable)
    .set({
      gbpAccountId: accountId,
      gbpLocationId: locationId,
      gbpLocationName: locationName,
      gbpConnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(analyticsSiteTable.id, siteId));
};

const clearGbpConnectionOnSite = async (siteId: number): Promise<void> => {
  await db
    .update(analyticsSiteTable)
    .set({
      gbpAccountId: null,
      gbpLocationId: null,
      gbpLocationName: null,
      gbpConnectedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(analyticsSiteTable.id, siteId));
};

const getValidAccessToken = async (siteId: number): Promise<string> => {
  const refreshToken = await loadRefreshToken(siteId);
  if (!refreshToken) throw new Error("Site is not connected to Google Business Profile.");
  const tokens = await refreshAccessToken(refreshToken);
  return tokens.access_token;
};

// Business Profile Performance API — fetchMultiDailyMetricsTimeSeries
// https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries
// Scope: business.manage. Daily metric values are int64 strings; "value" is omitted when zero.

const GBP_DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
] as const;

type GbpDailyMetric = (typeof GBP_DAILY_METRICS)[number];

const GBP_METRIC_FIELD: Record<GbpDailyMetric, keyof GbpMetrics> = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impressionsDesktopSearch",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impressionsMobileSearch",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impressionsDesktopMaps",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impressionsMobileMaps",
  CALL_CLICKS: "callClicks",
  WEBSITE_CLICKS: "websiteClicks",
  BUSINESS_DIRECTION_REQUESTS: "directionRequests",
  BUSINESS_CONVERSATIONS: "conversations",
  BUSINESS_BOOKINGS: "bookings",
};

const emptyGbpMetrics = (): GbpMetrics => ({
  impressionsDesktopSearch: 0,
  impressionsMobileSearch: 0,
  impressionsDesktopMaps: 0,
  impressionsMobileMaps: 0,
  callClicks: 0,
  websiteClicks: 0,
  directionRequests: 0,
  conversations: 0,
  bookings: 0,
});

type GbpFetchResponse = {
  multiDailyMetricTimeSeries?: Array<{
    dailyMetricTimeSeries?: Array<{
      dailyMetric: GbpDailyMetric;
      timeSeries?: {
        datedValues?: Array<{
          date: { year: number; month: number; day: number };
          value?: string;
        }>;
      };
    }>;
  }>;
};

/**
 * Daily timeseries for a connected GBP location: one row per date in [startDate, endDate].
 * Strips locations/ prefix if caller passed it. Dates are YYYY-MM-DD.
 */
const fetchDailyTimeseries = async (
  siteId: number,
  locationId: string,
  startDate: string,
  endDate: string,
): Promise<Array<{ date: string; metrics: GbpMetrics }>> => {
  const accessToken = await getValidAccessToken(siteId);
  const id = locationId.startsWith("locations/") ? locationId.slice("locations/".length) : locationId;
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);

  const params = new URLSearchParams();
  for (const m of GBP_DAILY_METRICS) params.append("dailyMetrics", m);
  params.append("dailyRange.start_date.year", String(sy));
  params.append("dailyRange.start_date.month", String(sm));
  params.append("dailyRange.start_date.day", String(sd));
  params.append("dailyRange.end_date.year", String(ey));
  params.append("dailyRange.end_date.month", String(em));
  params.append("dailyRange.end_date.day", String(ed));

  const url = `https://businessprofileperformance.googleapis.com/v1/locations/${id}:fetchMultiDailyMetricsTimeSeries?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GBP Performance API ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as GbpFetchResponse;

  const byDate = new Map<string, GbpMetrics>();
  for (const outer of data.multiDailyMetricTimeSeries ?? []) {
    for (const inner of outer.dailyMetricTimeSeries ?? []) {
      const field = GBP_METRIC_FIELD[inner.dailyMetric];
      if (!field) continue;
      for (const dv of inner.timeSeries?.datedValues ?? []) {
        const dateStr = `${dv.date.year}-${String(dv.date.month).padStart(2, "0")}-${String(dv.date.day).padStart(2, "0")}`;
        const row = byDate.get(dateStr) ?? emptyGbpMetrics();
        row[field] = Number(dv.value ?? "0");
        byDate.set(dateStr, row);
      }
    }
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, metrics]) => ({ date, metrics }));
};

// ---------------------------------------------------------------------------
// Service items (write path)
//
// Business Information API. A location's `serviceItems` is either a structured
// service (tied to a valid serviceTypeId from one of the location's categories)
// or a free-form service (a custom label under a category). PATCH with
// updateMask=serviceItems REPLACES THE WHOLE LIST, so callers must always
// read-modify-write via mergeServiceItems and never blind-overwrite.
// https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch
// ---------------------------------------------------------------------------

const BIZINFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";

type GbpServiceLabel = {
  displayName: string;
  description?: string;
  languageCode?: string;
};
type StructuredServiceItem = { serviceTypeId: string; description?: string };
type FreeFormServiceItem = { categoryId: string; label: GbpServiceLabel };
type ServiceItem = {
  // Required by the API on each item; whether the business offers this service.
  isOffered?: boolean;
  structuredServiceItem?: StructuredServiceItem;
  freeFormServiceItem?: FreeFormServiceItem;
};

type GbpServiceType = { serviceTypeId: string; displayName?: string };
type GbpCategory = {
  name: string;
  displayName?: string;
  serviceTypes?: GbpServiceType[];
};

type LocationServiceInfo = {
  locationName: string;
  title: string | null;
  regionCode: string | null;
  serviceItems: ServiceItem[];
  primaryCategory: GbpCategory | null;
  additionalCategories: GbpCategory[];
};

/** Fetch a location's current service items plus its categories. */
const getLocationServiceInfo = async (
  accessToken: string,
  locationName: string
): Promise<LocationServiceInfo> => {
  const readMask = "title,serviceItems,categories,storefrontAddress";
  const url = `${BIZINFO_BASE}/${locationName}?readMask=${encodeURIComponent(readMask)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`GBP getLocation failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    title?: string;
    serviceItems?: ServiceItem[];
    categories?: { primaryCategory?: GbpCategory; additionalCategories?: GbpCategory[] };
    storefrontAddress?: { regionCode?: string };
  };
  return {
    locationName,
    title: json.title ?? null,
    regionCode: json.storefrontAddress?.regionCode ?? null,
    serviceItems: json.serviceItems ?? [],
    primaryCategory: json.categories?.primaryCategory ?? null,
    additionalCategories: json.categories?.additionalCategories ?? [],
  };
};

/**
 * The valid structured service types (serviceTypeId + display name) available
 * for a set of category resource names, via categories:batchGet (view=FULL).
 * A location's own `categories` readMask doesn't include serviceTypes, so this
 * separate call is required to know which structured items are legal.
 */
const getCategoryServiceTypes = async (
  accessToken: string,
  categoryNames: string[],
  regionCode = "US",
  languageCode = "en"
): Promise<GbpCategory[]> => {
  const names = categoryNames.filter(Boolean);
  if (names.length === 0) return [];
  const params = new URLSearchParams({ view: "FULL", regionCode, languageCode });
  for (const name of names) params.append("names", name);
  const url = `${BIZINFO_BASE}/categories:batchGet?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`GBP categories:batchGet failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { categories?: GbpCategory[] };
  return json.categories ?? [];
};

/** Replace a location's service list. PATCH replaces the WHOLE list. */
const setLocationServiceItems = async (
  accessToken: string,
  locationName: string,
  serviceItems: ServiceItem[]
): Promise<LocationServiceInfo> => {
  const url = `${BIZINFO_BASE}/${locationName}?updateMask=serviceItems`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ serviceItems }),
  });
  if (!res.ok) {
    throw new Error(`GBP setServiceItems failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    title?: string;
    serviceItems?: ServiceItem[];
    categories?: { primaryCategory?: GbpCategory; additionalCategories?: GbpCategory[] };
    storefrontAddress?: { regionCode?: string };
  };
  return {
    locationName,
    title: json.title ?? null,
    regionCode: json.storefrontAddress?.regionCode ?? null,
    serviceItems: json.serviceItems ?? [],
    primaryCategory: json.categories?.primaryCategory ?? null,
    additionalCategories: json.categories?.additionalCategories ?? [],
  };
};

/** Stable identity for a service item, used to dedupe on merge. */
const serviceItemKey = (item: ServiceItem): string => {
  if (item.structuredServiceItem) {
    return `structured:${item.structuredServiceItem.serviceTypeId}`;
  }
  if (item.freeFormServiceItem) {
    const { categoryId, label } = item.freeFormServiceItem;
    return `freeform:${categoryId}:${label.displayName.trim().toLowerCase()}`;
  }
  return "unknown";
};

/**
 * Read-modify-write merge. APPEND-ONLY by design: desired items not already
 * present are added, existing items are never removed — so a sync can never
 * wipe services a client set up outside our tooling.
 */
const mergeServiceItems = (
  current: ServiceItem[],
  desired: ServiceItem[]
): { merged: ServiceItem[]; added: ServiceItem[]; unchanged: ServiceItem[] } => {
  const currentKeys = new Set(current.map(serviceItemKey));
  const seen = new Set<string>();
  const added: ServiceItem[] = [];
  const unchanged: ServiceItem[] = [];
  for (const item of desired) {
    const key = serviceItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    if (currentKeys.has(key)) unchanged.push(item);
    else added.push(item);
  }
  return { merged: [...current, ...added], added, unchanged };
};

/**
 * Map a plain list of service names to GBP service items ("Both" strategy):
 * a name matching one of the categories' predefined serviceTypes (by display
 * name, case-insensitive) becomes a structured item; otherwise it becomes a
 * free-form item under the primary category. Names with no structured match
 * and no primary category to attach to are returned as `unmapped`.
 */
const mapServiceNamesToItems = (
  names: string[],
  categories: GbpCategory[],
  primaryCategoryId: string | null,
  languageCode = "en"
): {
  items: ServiceItem[];
  structuredCount: number;
  freeFormCount: number;
  unmapped: string[];
} => {
  const serviceTypeByName = new Map<string, string>();
  for (const cat of categories) {
    for (const st of cat.serviceTypes ?? []) {
      if (st.displayName) {
        serviceTypeByName.set(st.displayName.trim().toLowerCase(), st.serviceTypeId);
      }
    }
  }

  const items: ServiceItem[] = [];
  const unmapped: string[] = [];
  const seen = new Set<string>();
  let structuredCount = 0;
  let freeFormCount = 0;

  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const serviceTypeId = serviceTypeByName.get(key);
    if (serviceTypeId) {
      items.push({ isOffered: true, structuredServiceItem: { serviceTypeId } });
      structuredCount++;
    } else if (primaryCategoryId) {
      items.push({
        isOffered: true,
        freeFormServiceItem: {
          categoryId: primaryCategoryId,
          label: { displayName: name, languageCode },
        },
      });
      freeFormCount++;
    } else {
      unmapped.push(name);
    }
  }

  return { items, structuredCount, freeFormCount, unmapped };
};

export {
  GBP_PROVIDER_KEY,
  buildAuthState,
  verifyAuthState,
  buildAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  enumerateAllLocations,
  enumerateLocationsForSite,
  storeRefreshToken,
  loadRefreshToken,
  deleteRefreshToken,
  updateGbpLocationOnSite,
  clearGbpConnectionOnSite,
  getValidAccessToken,
  fetchDailyTimeseries,
  getLocationServiceInfo,
  getCategoryServiceTypes,
  setLocationServiceItems,
  mergeServiceItems,
  serviceItemKey,
  mapServiceNamesToItems,
};

export type {
  EnumeratedLocation,
  ServiceItem,
  StructuredServiceItem,
  FreeFormServiceItem,
  GbpServiceLabel,
  GbpCategory,
  GbpServiceType,
  LocationServiceInfo,
};
