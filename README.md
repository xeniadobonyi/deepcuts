# deep cuts

**Discover new music, build your record crates.**

Live at **[digdeepcuts.com](https://digdeepcuts.com)**. Free, no sign-up, no ads.

I think taste can be acquired. You're not born with a taste in music: you listen, you discover records, and slowly you acquire a certain taste. Deep Cuts helps you find the next record to listen to, using what people have documented online about records: producers, session players, samples and labels.

## How it works

- **Dig from records you love.** Give it up to three albums, songs or artists and it digs up five records you probably haven't heard, each with a short reason.
- **Or describe a vibe.** For example "brazilian samba-jazz", "ibiza house" or "california 70s".
- **Real records only.** Every candidate comes from real connections documented on [MusicBrainz](https://musicbrainz.org) and [Discogs](https://www.discogs.com): the same producer, engineer or session players, samples, band members, labels. The AI never invents a record. It only chooses from that pool and explains why.
- **A mix of classics and deep cuts.** Discogs collector counts sort each candidate into Essential (3,000+ owners), Digger favourite (1,000–3,000) or Deep cut (under 1,000). Each dig mixes them, and "Dig deeper" goes rarer each time.
- **Now spinning.** Every visit opens with a song from a great album: a hand-picked record from the shop's crate, or one your own digs found but didn't show you. Listen on YouTube, Spotify or Apple Music, love it, or dig from it.

## What you can do

- Love records, and build crates of up to 10 records you're proud of
- Share a crate as a link, with a preview card listing its records
- See your taste profile: the genres, decades and producers you keep coming back to, with a short written analysis
- Move up seven levels from *Just Browsing* to *Ultimate Digger* as you love more records
- See each record's rarity: `RARITY ▮▮▮▯▯  Discogs 2,140 own / 3,310 want`

Everything you do is saved in your own browser. There are no accounts. Visits are counted anonymously with Vercel Web Analytics (no cookies).

## How it's built

One static page plus a few small server functions, all on free tiers.

| Part | What it does |
| --- | --- |
| `index.html` | the whole site |
| `api/dig.js` | sends each AI request to [Claude](https://www.anthropic.com/claude) or an open model (gpt-oss) on [Groq](https://groq.com) and streams the answer back: picks go to Claude Sonnet first, behind-the-scenes calls to Groq, and each backs up the other; keys stay on the server |
| `api/mb.js` | cached, rate-limited MusicBrainz lookups: credits, relationships, labels, samples |
| `api/discogs.js` | Discogs collector counts, credits, and the backup for records MusicBrainz doesn't know; also powers vibe digs by style, country and years |
| `api/cover.js` | checks each album exists and finds its cover on the [Cover Art Archive](https://coverartarchive.org) |
| `api/crate.js`, `api/og.js` | shared crate links and their preview images |

I built it with AI as a coding partner: I made the product and design decisions, and Claude helped write and test the code.

## Run your own

1. Create a free API key at [console.groq.com](https://console.groq.com).
2. Import this repo as a new project on [Vercel](https://vercel.com) (the free Hobby plan is enough) and deploy.
3. In Settings → Environment Variables, add `GROQ_API_KEY`, and optionally `ANTHROPIC_API_KEY` (from [console.anthropic.com](https://console.anthropic.com)) to have Claude choose the picks. Then redeploy. With only one key, that service does everything.
4. To use your own domain, add it in Vercel and to `SERVER_HOSTS` and `SITE_URL` near the top of the script in `index.html`.

Optional environment variables:

- `DISCOGS_TOKEN`: a free personal access token from discogs.com → Settings → Developers. Turns on rarity, collector counts and Discogs credits. Discogs' API terms apply.
- `CLAUDE_MODEL`: the Claude model for picks (default `claude-sonnet-5-5`; `claude-haiku-5-5` is cheaper and faster).
- `MODEL`: the Groq model to use (default `openai/gpt-oss-120b`; a smaller model is tried when it's busy).
- `REQUESTS_PER_DAY`: AI requests allowed per visitor per day (default 150, `0` turns it off).

If every model is busy or out of allowance at once, the shop shows a friendly "busy" or "closed for digging until tomorrow" message. Set a spend limit in the Anthropic Console to cap costs; when it's reached, Groq takes over.

## License

The code is released under the [MIT License](LICENSE). The Geist fonts in `api/_fonts` are under the SIL Open Font License (see `api/_fonts/Geist-LICENSE.txt`). Record data belongs to MusicBrainz and Discogs and follows their terms.

## Feedback

Found a bug or have an idea? Open an issue, or write to [xenerr@gmail.com](mailto:xenerr@gmail.com?subject=Deep%20Cuts%20feedback).

---

Every record here was found through credits and collections shared by music lovers on MusicBrainz and Discogs. Deep Cuts isn't affiliated with either.
