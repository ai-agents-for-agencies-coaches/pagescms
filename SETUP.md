# Client Cockpit Setup (fork and deploy your own)

You are deploying your own copy of the Client Cockpit. Your client logs in with a magic link to edit their own site and see their rankings and leads. You own it and can customize anything, and you can still pull updates from the upstream repo.

**Time:** about 15 minutes. **Cost:** free tiers cover everything to start.

## What you need (all free to start)
- A GitHub account
- A Vercel account (deploy)
- A Postgres database (Neon free tier recommended)
- A Resend account (sends the magic-link login emails)

---

## 1. Fork this repo
Click **Fork** (top right of the repo) to create `your-username/pagescms`. Then clone your fork locally:
```
gh repo clone your-username/pagescms
cd pagescms
npm install
```

> Clone this as its own standalone project, in a **sibling folder next to your site builder, not inside it**. The Cockpit is a separate Next.js app with its own dependencies and its own Vercel deploy, so nesting it inside the site-builder repo causes git and tooling conflicts. Example layout:
> ```
> projects/
> ├── autonomous-agency-starter/   (site builder, deploys to Netlify)
> └── pagescms/                    (your Cockpit fork, deploys to Vercel)
> ```

## 2. Create a Postgres database (Neon, free)
Go to neon.tech, create a project, and copy the connection string into `DATABASE_URL`. (Supabase or Vercel Postgres work too.)

On Neon, also copy the **direct (unpooled)** connection string into `DATABASE_URL_UNPOOLED`. Migrations run against the unpooled URL, so setting both avoids a common first-deploy migration error.

## 3. Generate two secrets
```
openssl rand -hex 32     # use as BETTER_AUTH_SECRET
openssl rand -hex 32     # use as CRYPTO_KEY
```

## 4. Get a Resend API key
Go to resend.com, create an API key. To start, use Resend's onboarding sender for `EMAIL_FROM` (you can add your own domain later).

## 5. Deploy the fork to Vercel
Go to vercel.com/new and import `your-username/pagescms`. Add these environment variables (the required set):

| Variable | Value |
|----------|-------|
| `BETTER_AUTH_SECRET` | first secret from step 3 |
| `CRYPTO_KEY` | second secret from step 3 |
| `DATABASE_URL` | connection string from step 2 |
| `RESEND_API_KEY` | from step 4 |
| `EMAIL_FROM` | e.g. `Your Agency <onboarding@resend.dev>` |
| `BASE_URL` | your Vercel URL (set it after the first deploy, then redeploy) |

Deploy. Database migrations run automatically (`postbuild`). Copy your live URL (e.g. `https://your-cockpit.vercel.app`).

## 6. Create your GitHub App (automated)
This is what lets clients edit their site repos. From your local clone:
```
node scripts/setup-github-app.mjs --base-url https://YOUR-VERCEL-URL --app-name "Your Agency CMS" --env .env.github
```
A browser tab opens, click **Create** and approve. The script writes six `GITHUB_APP_*` variables into `.env.github`. Add all six to your Vercel project's environment variables, then redeploy.

## 7. Verify and log in
```
node scripts/check-setup.mjs
```
This checks every required variable is set and that the database is reachable. When it is all green, open your live URL, log in with the magic link, and connect your client's Week-1 site repo.

---

## Optional: turn on the analytics tab
The Cockpit works without these. They light up the rankings and leads charts:
- Google Search Console + GA4: `GOOGLE_SERVICE_ACCOUNT_JSON_B64`
- Bing Webmaster: `BING_WEBMASTER_API_KEY`
- Leads (call/form tracking): `WHATCONVERTS_API_TOKEN` + `WHATCONVERTS_API_SECRET`, `NETLIFY_PAT`

See `.env.local.example` for the full list. Add them in Vercel and redeploy when you are ready.

## Pulling upstream updates
Your fork stays linked to the source. To get new features:
```
git remote add upstream https://github.com/ai-agents-for-agencies-coaches/pagescms.git
git fetch upstream && git merge upstream/main
```
Push to your fork and Vercel redeploys automatically.
