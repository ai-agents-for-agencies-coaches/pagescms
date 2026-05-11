import "../db/envConfig";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const main = async () => {
  const sites = await sql<{ id: number; owner: string; repo: string }[]>`
    select id, owner, repo from analytics_site
    where repo ilike '%terzo%' or owner ilike '%terzo%'
  `;
  console.log("sites:", sites);
  if (sites.length === 0) {
    await sql.end();
    return;
  }

  for (const s of sites) {
    console.log(`\n=== site ${s.id} (${s.owner}/${s.repo}) ===`);

    const perProvider = await sql<
      { provider: string; max_date: string; n: number; last_fetch: Date }[]
    >`
      select provider, max(date) as max_date, count(*)::int as n, max(fetched_at) as last_fetch
      from analytics_daily where site_id = ${s.id}
      group by provider order by provider
    `;
    console.log("analytics_daily by provider:");
    for (const r of perProvider) {
      console.log(`  ${r.provider}: max_date=${r.max_date} rows=${r.n} last_fetch=${r.last_fetch?.toISOString?.() ?? r.last_fetch}`);
    }

    const dim = await sql<{ provider: string; max_date: string; n: number; last_fetch: Date }[]>`
      select provider, max(date) as max_date, count(*)::int as n, max(fetched_at) as last_fetch
      from analytics_dimension where site_id = ${s.id}
      group by provider order by provider
    `;
    console.log("analytics_dimension by provider:");
    for (const r of dim) {
      console.log(`  ${r.provider}: max_date=${r.max_date} rows=${r.n} last_fetch=${r.last_fetch?.toISOString?.() ?? r.last_fetch}`);
    }

    const act = await sql<{ source: string; max_date: string; n: number; last_created: Date }[]>`
      select source, max(date) as max_date, count(*)::int as n, max(created_at) as last_created
      from analytics_activity where site_id = ${s.id}
      group by source order by source
    `;
    console.log("analytics_activity by source:");
    for (const r of act) {
      console.log(`  ${r.source}: max_date=${r.max_date} rows=${r.n} last_created=${r.last_created?.toISOString?.() ?? r.last_created}`);
    }
  }

  await sql.end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
