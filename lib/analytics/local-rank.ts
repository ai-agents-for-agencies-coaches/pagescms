import "server-only";

// Local rank heat-map via RapidAPI's "Local Rank Tracker" endpoint.
// https://rapidapi.com/local-rank-tracker — /grid returns ranked Google
// Maps results across an N×N geographic grid centered on (lat, lng).

const RAPID_API_HOST = "local-rank-tracker.p.rapidapi.com";

const requireEnv = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

export type HeatMapCell = {
  row: number;
  col: number;
  lat: number;
  lng: number;
  /** Rank of the target business in this cell, or null if not found. */
  rank: number | null;
  /** Top 3 competitors at this cell — name + placeId for tooltips. */
  top3: Array<{ rank: number; name: string; placeId: string }>;
};

export type HeatMapSummary = {
  totalPoints: number;
  foundCount: number;
  foundPercent: number;
  /** Mean rank across cells where business was found. Null if foundCount=0. */
  averageRank: number | null;
  /** Mean rank treating not-found cells as max-rank+1 (worst case). */
  averageTotalRank: number | null;
  /** % of cells where the business ranked in top 3. */
  top3Percent: number;
};

export type HeatMapResult = {
  summary: HeatMapSummary;
  grid: HeatMapCell[];
};

export type FetchHeatMapParams = {
  keyword: string;
  placeId: string;
  lat: string | number;
  lng: string | number;
  gridSize?: number;
  radius?: number;
  radiusUnits?: "km" | "miles";
  shape?: "square" | "circle";
  zoom?: number;
};

type RapidCompetitor = {
  rank: number;
  place_id: string;
  name: string;
};

type RapidCell = {
  lat: number;
  lng: number;
  index: [number, number];
  found: boolean;
  rank: number;
  count: number;
  results?: RapidCompetitor[];
};

type RapidResponse = {
  status: string;
  data: {
    points: number;
    found: number;
    found_percent: number;
    average_rank: number;
    average_total_rank: number;
    top_3_rank_percent: number;
    results: RapidCell[];
  };
};

export const fetchHeatMap = async (params: FetchHeatMapParams): Promise<HeatMapResult> => {
  const apiKey = requireEnv("LOCAL_RANK_TRACKER_API_KEY");
  const url = new URL(`https://${RAPID_API_HOST}/grid`);
  url.searchParams.set("place_id", params.placeId);
  url.searchParams.set("query", params.keyword);
  url.searchParams.set("lat", String(params.lat));
  url.searchParams.set("lng", String(params.lng));
  url.searchParams.set("grid_size", String(params.gridSize ?? 5));
  url.searchParams.set("radius", String(params.radius ?? 5));
  url.searchParams.set("radius_units", params.radiusUnits ?? "km");
  url.searchParams.set("shape", params.shape ?? "square");
  url.searchParams.set("zoom", String(params.zoom ?? 13));

  const res = await fetch(url, {
    headers: {
      "x-rapidapi-host": RAPID_API_HOST,
      "x-rapidapi-key": apiKey,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`local-rank-tracker ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as RapidResponse;
  if (json.status !== "OK") {
    throw new Error(`local-rank-tracker returned status=${json.status}`);
  }

  const d = json.data;
  return {
    summary: {
      totalPoints: d.points,
      foundCount: d.found,
      foundPercent: d.found_percent,
      averageRank: d.found > 0 ? d.average_rank : null,
      averageTotalRank: d.found > 0 ? d.average_total_rank : null,
      top3Percent: d.top_3_rank_percent,
    },
    grid: d.results.map((cell) => ({
      row: cell.index[0],
      col: cell.index[1],
      lat: cell.lat,
      lng: cell.lng,
      rank: cell.found ? cell.rank : null,
      top3: (cell.results ?? [])
        .slice(0, 3)
        .map((c) => ({ rank: c.rank, name: c.name, placeId: c.place_id })),
    })),
  };
};
