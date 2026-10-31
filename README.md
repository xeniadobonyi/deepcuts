# Deep Cuts

Deep Cuts learns your taste and digs for you: five records you probably haven't heard, each with the reason it was picked.

The site is a single static page (`index.html`) hosted on GitHub Pages: https://xeniadobonyi.github.io/deepcuts/

## What works

- Start a dig from up to three records you love, a mood, or both
- Five picks, each with the connection to your taste and links to YouTube, Spotify, Apple Music, Bandcamp and Discogs
- Reactions (Loved it, Not for me, Already know it), past digs and a taste profile, saved in your browser

## How live digs reach Claude

The page tries these in order:

1. **Inside claude.ai**, it uses the viewer's own Claude account.
2. **The Deep Cuts server** (`server/`), if `API_URL` is set near the top of the script in `index.html`. This is how the public site should work: the API key stays on the server.
3. **A Claude API key saved in the browser.** Until the server is deployed, paste a key under "Connect Claude" on the page. It is stored only in that browser and sent only to Anthropic. Use this for your own testing, not for the public.

## Deploying the server (Cloudflare Workers, free tier)

1. Create a Claude API key in the Claude Console, and set a monthly spending limit there.
2. Install Wrangler and sign in to Cloudflare:
   ```
   npm install -g wrangler
   wrangler login
   ```
3. From the `server/` folder, store the key as a secret and deploy:
   ```
   cd server
   wrangler secret put ANTHROPIC_API_KEY
   wrangler deploy
   ```
4. Wrangler prints a URL like `https://deepcuts-api.<account>.workers.dev`. Put it in `index.html`:
   ```
   const API_URL = "https://deepcuts-api.<account>.workers.dev";
   ```
5. Commit and push. The "Connect Claude" box disappears and everyone can dig.

`ALLOWED_ORIGINS` in `server/wrangler.toml` restricts calls to the GitHub Pages site. An optional per-visitor rate limit is included there, commented out.

## Still to build

- A MusicBrainz check that every recommended album exists
- Official album artwork (Spotify or Apple Music APIs)
- Email sign-in, so history follows people across devices
- Privacy policy and terms (GDPR)
