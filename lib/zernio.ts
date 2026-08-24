/**
 * Thin Zernio API client.
 *
 * Zernio hosts the OAuth apps for Google Business Profile (and 14 other platforms), so a
 * client can connect their own profile without us shipping an approved Google Business
 * Profile API application. One Zernio "profile" per client is their multi-tenant model.
 */

const BASE = process.env.ZERNIO_API_BASE?.trim() || "https://zernio.com/api/v1";

export const ZERNIO_CONFIGURED = Boolean(process.env.ZERNIO_API_KEY?.trim());

type ZernioOptions = {
  query?: Record<string, string | undefined>;
  body?: unknown;
};

export async function zernio(
  method: "GET" | "POST" | "DELETE",
  endpoint: string,
  options: ZernioOptions = {}
): Promise<any> {
  const key = process.env.ZERNIO_API_KEY?.trim();
  if (!key) throw new Error("ZERNIO_API_KEY is not set");

  const url = new URL(BASE + endpoint);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    // ACCOUNT_DISCONNECTED means the client must re-authorize. Surface that plainly
    // rather than letting a weekly routine fail silently.
    if (json?.code === "ACCOUNT_DISCONNECTED") {
      throw new Error(
        `This Google Business Profile is disconnected and must be reconnected. ${json.error ?? ""}`
      );
    }
    throw new Error(
      `Zernio ${method} ${endpoint} -> ${response.status}: ${text.slice(0, 300)}`
    );
  }

  return json;
}

export async function listGoogleBusinessLocations(
  profileId: string,
  tokens: { pendingDataToken?: string; tempToken?: string } = {}
) {
  return zernio("GET", "/connect/googlebusiness/locations", {
    query: {
      profileId,
      pendingDataToken: tokens.pendingDataToken,
      tempToken: tokens.tempToken,
    },
  });
}

/**
 * Complete the headless GBP selection.
 *
 * Note the shape: Zernio wants the bare `locationId`, plus the `pendingDataToken` the OAuth
 * redirect handed us. An earlier version of this posted `{ profileId, locationName }`, which
 * the API rejects — `name` in the locations payload is the BUSINESS name, not a resource id.
 */
export async function selectGoogleBusinessLocation(args: {
  profileId: string;
  locationId: string;
  pendingDataToken?: string;
  accountId?: string;
}) {
  return zernio("POST", "/connect/googlebusiness/select-location", {
    body: {
      profileId: args.profileId,
      locationId: args.locationId,
      pendingDataToken: args.pendingDataToken,
      accountId: args.accountId,
    },
  });
}

export async function listAccounts(profileId: string) {
  return zernio("GET", "/accounts", { query: { profileId } });
}

/** The connected googlebusiness account for a profile, or null if none is connected yet. */
export async function findGoogleBusinessAccount(profileId: string) {
  const accounts = await listAccounts(profileId);
  const list = accounts?.accounts ?? accounts?.data ?? [];
  if (!Array.isArray(list)) return null;
  return list.find((a: any) => a?.platform === "googlebusiness") ?? null;
}

/** One Zernio profile per client. Created on demand the first time a site connects. */
export async function createProfile(name: string) {
  const data = await zernio("POST", "/profiles", { body: { name } });
  const profile = data?.profile ?? data?.data ?? data;
  const id = profile?._id ?? profile?.id ?? null;
  if (!id) {
    throw new Error(
      `Zernio created no profile id for "${name}": ${JSON.stringify(data).slice(0, 200)}`
    );
  }
  return String(id);
}
