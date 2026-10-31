# Deep Cuts

Deep Cuts learns your taste and digs for you: five records you probably haven't heard, each with the reason it was picked.

This is the first prototype, a single static page (`index.html`) hosted on GitHub Pages.

## What works

- Start a dig from up to three records you love, a mood, or both
- A sample dig showing the format: five records, the connection to your taste, and links to YouTube, Spotify, Apple Music, Bandcamp and Discogs
- Reactions (Loved it, Not for me, Already know it), past digs and a taste profile, saved in your browser

## Not yet live

Live digs and taste summaries need an AI backend. On this static site the page shows the sample dig only. Next steps:

- Server-side AI calls with per-user limits and a spending cap
- A MusicBrainz check that every recommended album exists
- Official album artwork (Spotify or Apple Music APIs)
- Email sign-in, so history follows people across devices
- Privacy policy and terms (GDPR)
