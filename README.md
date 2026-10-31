# Deep Cuts

Deep Cuts learns your taste and digs for you: five records you probably haven't heard, each with the reason it was picked.

## What's here

- `index.html`: the whole site, one static page
- `api/cover.js`: checks each recommended album exists on MusicBrainz and finds its cover in the Cover Art Archive
- `api/dig.js`: a small Vercel Function that sends each dig to Groq's free AI API and streams the answer back. The key stays on the server; visitors never see it or need an account.

Everything runs on free tiers: Vercel Hobby for hosting and Groq's free API for the AI. Each visitor gets 5 digs a day. Groq's free allowance is shared by all visitors, so on a very busy day digs may pause until the next day.

## What works

- Start a dig from up to three records you love, a mood, or both
- Five picks, each with the connection to your taste and links to YouTube, Spotify, Apple Music, Bandcamp and Discogs
- Reactions (Loved it, Not for me, Already know it), past digs and a taste profile, saved in the visitor's browser

## Going live on Vercel (free Hobby plan)

1. Create a free account at console.groq.com (no card needed) and create an API key.
2. Sign in at vercel.com with GitHub.
3. Add New → Project → import `xeniadobonyi/deepcuts`. Leave the settings as they are and deploy.
4. In the project, open Settings → Environment Variables and add `GROQ_API_KEY` with your key. Then redeploy (Deployments → ⋯ → Redeploy).
5. Open the `.vercel.app` address Vercel gives you. Digs now work for everyone.

Optional environment variables:

- `MODEL`: the Groq model to use (default `openai/gpt-oss-120b`)
- `REQUESTS_PER_DAY`: server-side requests per visitor per day (default 16: 5 digs, the occasional replacement request, and taste summaries)

The GitHub Pages copy (xeniadobonyi.github.io/deepcuts) has no server, so it shows the sample dig only. Share the Vercel address instead.

To use a custom domain, add it in Vercel and add it to `SERVER_HOSTS` near the top of the script in `index.html`.

## Still to build

- Official album artwork (Spotify or Apple Music APIs)
- Email sign-in, so history follows people across devices
- Privacy policy and terms (GDPR)
