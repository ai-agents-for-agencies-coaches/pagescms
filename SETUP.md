# Client Cockpit Setup (deploy from Claude Code)

Deploy your own copy of the Client Cockpit with Claude Code driving the Vercel CLI. Claude runs the commands, you click through three quick one-time browser prompts. Your client logs in with a magic link to edit their site and see their rankings and leads.

**Time:** about 15 minutes. **Accounts (free):** GitHub, Vercel, Resend. The database is provisioned from the CLI, so no separate database signup.

## 1. Fork, clone, and open in Claude Code
Click **Fork** to create `your-username/pagescms`, then:
```
gh repo clone your-username/pagescms
cd pagescms
npm install
```
> Clone it as its own project, a **sibling folder next to your site builder, not inside it**. The Cockpit is a separate Next.js app with its own deploy; nesting it causes git and tooling conflicts.

Open the `pagescms` folder in Claude Code.

## 2. Log in to Vercel (once)
```
npm i -g vercel      # if you do not have the CLI
vercel login         # opens the browser
vercel whoami        # confirm you are logged into the right account
```

## 3. Get your three values ready
- Two secrets, run twice: `openssl rand -hex 32` (one for `BETTER_AUTH_SECRET`, one for `CRYPTO_KEY`)
- A Resend API key from resend.com (`RESEND_API_KEY`)

## 4. Hand the deploy to Claude Code
Paste this prompt into Claude Code (fill in your two secrets and Resend key). Claude runs each step and pauses where you need to act in the browser:
```
Deploy this Cockpit to Vercel from the CLI. Do these in order, and pause when I need to do something in a browser:
1. vercel link --yes
2. vercel integration add neon   (to provision Postgres; pick the Postgres product if asked; if a browser opens to accept terms, pause, it resumes on its own)
3. Set these as PRODUCTION env vars using `vercel env add` (value via stdin, never NAME=value):
   BETTER_AUTH_SECRET = <secret 1>
   CRYPTO_KEY = <secret 2>
   RESEND_API_KEY = <my Resend key>
   EMAIL_FROM = My Agency <onboarding@resend.dev>
4. vercel --prod   then tell me the deployed URL
5. Set BASE_URL to that URL (vercel env add), then vercel --prod again
6. Run: node scripts/setup-github-app.mjs --base-url <URL> --app-name "My Agency CMS" --env .env.github
   then pause so I can click Create and approve in the browser
7. Read the six GITHUB_APP_* values from .env.github and set each as a PRODUCTION env var, then vercel --prod once more
8. Run node scripts/check-setup.mjs and confirm every item is green
```

## 5. The three browser prompts you will click
1. **Vercel login** (step 2)
2. **Neon terms**, first time only (Claude waits and continues automatically)
3. **GitHub App**: click Create and approve (step 6)

## 6. Done
When `check-setup.mjs` is all green, open your live URL, log in with the magic link, and connect your client's Week-1 site repo. That is the Cockpit live.

---

## Later: analytics tab (optional)
The Cockpit works without these; they light up the rankings and leads charts. Add them the same way (`vercel env add ... production`), full list in `.env.local.example`: GSC + GA4 (`GOOGLE_SERVICE_ACCOUNT_JSON_B64`), Bing (`BING_WEBMASTER_API_KEY`), leads (`WHATCONVERTS_API_TOKEN` + `WHATCONVERTS_API_SECRET`, `NETLIFY_PAT`).

## Later: pull upstream updates
```
git remote add upstream https://github.com/ai-agents-for-agencies-coaches/pagescms.git
git fetch upstream && git merge upstream/main
```
Push to your fork and Vercel redeploys automatically.
