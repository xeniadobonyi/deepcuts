// Deep Cuts album check (Vercel Function): looks an album up on MusicBrainz.
//   /api/cover?artist=…&album=…          → redirects to the front cover (Cover Art Archive), or 404
//   /api/cover?artist=…&album=…&check=1  → JSON {found, cover}: whether the album exists, and its cover URL
// Free, no key needed. Results are cached by Vercel's CDN, so each album is looked up only once in a while.

const UA = "DeepCuts/1.0 (https://github.com/xeniadobonyi/deepcuts)";

const clean = (s) => String(s || "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const artist = clean(url.searchParams.get("artist"));
  const album = clean(url.searchParams.get("album"));
  const check = url.searchParams.get("check") === "1";
  if (!artist || !album) { res.statusCode = 400; return res.end("artist and album are required"); }

  const reply = (status, data, cache) => {
    res.statusCode = status;
    if (cache) res.setHeader("cache-control", cache);
    if (check) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(data)); }
    if (data.cover) { res.statusCode = 302; res.setHeader("location", data.cover); return res.end(); }
    return res.end(data.found === null ? "lookup unavailable" : "no cover");
  };

  let groups = [];
  try {
    const q = `releasegroup:"${album}" AND artist:"${artist}"`;
    const ask = () => fetch("https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=5&query=" + encodeURIComponent(q), {
      headers: { "user-agent": UA, accept: "application/json" },
    });
    let r = await ask();
    // MusicBrainz allows about one request a second; when busy, wait and try once more.
    if (r.status === 503 || r.status === 429) { await new Promise((ok) => setTimeout(ok, 1200)); r = await ask(); }
    if (!r.ok) return reply(503, { found: null, cover: null }); // not cached: try again later
    groups = (await r.json())["release-groups"] || [];
  } catch {
    return reply(503, { found: null, cover: null });
  }

  const best = groups.find((g) => (g.score || 0) >= 85);
  if (!best) return reply(check ? 200 : 404, { found: false, cover: null }, "public, s-maxage=86400");

  const credit = (best["artist-credit"] || []).map((c) => (c.name || c.artist?.name || "") + (c.joinphrase || "")).join("").trim();
  return reply(200, {
    found: true,
    cover: `https://coverartarchive.org/release-group/${best.id}/front-250`,
    // MusicBrainz's own facts, so the page never has to show the AI's guesses
    artist: credit || null,
    title: best.title || null,
    year: String(best["first-release-date"] || "").slice(0, 4) || null,
    mbid: best.id,
  }, "public, s-maxage=2592000, stale-while-revalidate=86400");
};
