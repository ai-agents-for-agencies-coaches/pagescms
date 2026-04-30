// Temporary diagnostic endpoint — to be removed once env-var visibility is debugged.
// Auth via ADMIN_API_TOKEN bearer.

export const maxDuration = 10;

import { type NextRequest, NextResponse } from "next/server";

const isAuthorized = (request: NextRequest) => {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
};

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const allKeys = Object.keys(process.env).sort();
  const matching = allKeys.filter((k) =>
    /LOCAL|RAPID|CRON|GBP|ADMIN|PAPER|NETLIFY|GOOGLE/.test(k),
  );
  const localRankRaw = process.env.LOCAL_RANK_TRACKER_API_KEY;

  return NextResponse.json({
    status: "ok",
    total_env_keys: allKeys.length,
    matching_keys: matching,
    LOCAL_RANK_TRACKER_API_KEY: {
      defined: localRankRaw !== undefined,
      length: typeof localRankRaw === "string" ? localRankRaw.length : null,
      head: typeof localRankRaw === "string" ? localRankRaw.slice(0, 4) : null,
    },
    // Compare with a known-working var
    CRON_SECRET: {
      defined: process.env.CRON_SECRET !== undefined,
      length: typeof process.env.CRON_SECRET === "string" ? process.env.CRON_SECRET.length : null,
    },
  });
}
