# Client Cockpit Setup (fork and deploy your own)

Deploy your own copy of the Client Cockpit. Your client logs in with a magic link to edit their site and see their rankings and leads. You own it, you can customize it, and you can pull upstream updates.

**Time:** about 15 minutes. **Cost:** free tiers cover it. **Accounts:** GitHub, Vercel, Resend (login emails). The database is provisioned inside Vercel, so no separate database signup.

## 1. Fork and clone
Click **Fork** to create `your-username/pagescms`, then:
```
gh repo clone your-username/pagescms
cd pagescms
npm install
```
> Clone it as its own project, a **sibling folder next to your site builder, not inside it**. The Cockpit is a separate Next.js app with its own deploy; nesting it causes git and tooling conflicts.

## 2. Generate two secrets
```
openssl rand -hex 32     # BETTER_AUTH_SECRET
openssl rand -hex 32     # CRYPTO_KEY
```

## 3. Get a Resend API key
At resend.com, create an API key (`RESEND_API_KEY`). Use `onboarding@resend.dev` as your `EMAIL_FROM` for now, no domain to verify.

## 4. Import your fork into Vercel
Go to vercel.com/new and import `your-username/pagescms`. The first build will fail because there is no database yet. That is expected, the next two steps fix it.

## 5. Add the database (inside Vercel, no separate signup)
In your Vercel project: **Storage → Create Database → Neon** (Postgres, from the Marketplace). Vercel provisions it and adds the connection variables to the project automatically. Confirm it added **`DATABASE_URL`** and **`DATABASE_URL_UNPOOLED`** (Neon adds both; migrations use the unpooled one). If yours got `POSTGRES_*` names instead, copy their values into `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.

## 6. Add the rest of the env vars, then redeploy
In **Settings → Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `BETTER_AUTH_SECRET` | secret 1 from step 2 |
| `CRYPTO_KEY` | secret 2 from step 2 |
| `RESEND_API_KEY` | from step 3 |
| `EMAIL_FROM` | `Your Agency <onboarding@resend.dev>` |
| `BASE_URL` | your Vercel URL, e.g. `https://your-cockpit.vercel.app` |

Redeploy. Database migrations run automatically (`postbuild`). Note your live URL.

## 7. Create your GitHub App (automated)
This lets clients edit their site repos. From your clone:
```
node scripts/setup-github-app.mjs --base-url https://YOUR-VERCEL-URL --app-name "Your Agency CMS" --env .env.github
```
A browser tab opens, click **Create** and approve. It writes six `GITHUB_APP_*` variables into `.env.github`. Add all six to Vercel, then redeploy.

## 8. Verify and log in
```
node scripts/check-setup.mjs
```
When it is all green, open your live URL, log in with the magic link, and connect your client's Week-1 site repo.

---

## Later: analytics tab (optional)
The Cockpit works without these. They light up the rankings and leads charts. Add them in Vercel when ready (full list in `.env.local.example`): GSC + GA4 (`GOOGLE_SERVICE_ACCOUNT_JSON_B64`), Bing (`BING_WEBMASTER_API_KEY`), leads (`WHATCONVERTS_API_TOKEN` + `WHATCONVERTS_API_SECRET`, `NETLIFY_PAT`).

## Later: pull upstream updates
```
git remote add upstream https://github.com/ai-agents-for-agencies-coaches/pagescms.git
git fetch upstream && git merge upstream/main
```
Push to your fork and Vercel redeploys automatically.
