# Deep Cuts

Deep Cuts learns your taste and digs for you: five records you probably haven't heard, each with the reason it was picked.

## What's here

- `index.html`: the whole site, one static page
- `api/cover.js`: checks each recommended album exists on MusicBrainz and finds its cover in the Cover Art Archive
- `api/mb.js`: read-only MusicBrainz lookups (cached), used to find candidates through real links: the same label in the same years, the producers and engineers on a record, and related artists. The AI then chooses among those candidates and explains the picks.
- `api/discogs.js`: asks Discogs how many members own and want each candidate album. Records almost everyone owns are left out and rare, sought-after ones come first. Optional: it runs only when `DISCOGS_TOKEN` is set.
- Discogs is also the backup when MusicBrainz doesn't know a record yet (new and underground releases): suggestions, and digs from the record's label and credited people.
- `api/dig.js`: a small Vercel Function that sends each dig to Groq's free AI API and streams the answer back. The key stays on the server; visitors never see it or need an account.

Everything runs on free tiers: Vercel Hobby for hosting and Groq's free API for the AI. Groq's free allowance is shared by all visitors, so on a very busy day digs may pause until the next day.

## What works

- Start a dig from up to three albums, songs or artists you love, or from a vibe (keywords, a mood or a moment)
- Five picks, each with the connection to your taste and links to YouTube, Spotify, Apple Music and Discogs
- Suggestions and spelling corrections from MusicBrainz while typing records
- Reactions (Loved it, Not for me), crates, past digs and a taste profile, saved in the visitor's browser

## Going live on Vercel (free Hobby plan)

1. Create a free account at console.groq.com (no card needed) and create an API key.
2. Sign in at vercel.com with GitHub.
3. Add New → Project → import `xeniadobonyi/deepcuts`. Leave the settings as they are and deploy.
4. In the project, open Settings → Environment Variables and add `GROQ_API_KEY` with your key. Then redeploy (Deployments → ⋯ → Redeploy).
5. Open the `.vercel.app` address Vercel gives you. Digs now work for everyone.

Optional environment variables:

- `MODEL`: the Groq model to use (default `openai/gpt-oss-120b`)
- `REQUESTS_PER_DAY`: optional limit on requests per visitor per day (off unless set)
- `DISCOGS_TOKEN`: a free personal access token from discogs.com → Settings → Developers. Turns on the rarity filter, the rarity meter and producer credits for the taste profile (MusicBrainz is the backup for credits). Discogs' API terms apply: the site credits Discogs next to the counts, says it isn't affiliated with Discogs, and never shows counts more than 6 hours old.

The GitHub Pages copy (xeniadobonyi.github.io/deepcuts) has no server, so it shows the sample dig only. Share the Vercel address instead.

To use a custom domain, add it in Vercel and add it to `SERVER_HOSTS` near the top of the script in `index.html`.

## Still to build

- Official album artwork (Spotify or Apple Music APIs)
- Email sign-in, so history follows people across devices
- Privacy policy and terms (GDPR)
