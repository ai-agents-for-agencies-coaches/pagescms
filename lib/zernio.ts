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

export async function listGoogleBusinessLocations(profileId: string) {
  return zernio("GET", "/connect/googlebusiness/locations", { query: { profileId } });
}

export async function selectGoogleBusinessLocation(
  profileId: string,
  locationName: string
) {
  return zernio("POST", "/connect/googlebusiness/select-location", {
    body: { profileId, locationName },
  });
}

export async function listAccounts(profileId: string) {
  return zernio("GET", "/accounts", { query: { profileId } });
}
