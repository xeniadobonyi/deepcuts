// Deep Cuts cover lookup (Vercel Function): finds an album on MusicBrainz and redirects to its
// front cover in the Cover Art Archive. Free, no key needed. Results are cached by Vercel's CDN,
// so each album is looked up on MusicBrainz only once in a while.

const UA = "DeepCuts/1.0 (https://github.com/xeniadobonyi/deepcuts)";

const clean = (s) => String(s || "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const artist = clean(url.searchParams.get("artist"));
  const album = clean(url.searchParams.get("album"));
  if (!artist || !album) { res.statusCode = 400; return res.end("artist and album are required"); }

  const notFound = () => {
    res.statusCode = 404;
    res.setHeader("cache-control", "public, s-maxage=86400");
    res.end("no cover");
  };

  let groups = [];
  try {
    const q = `releasegroup:"${album}" AND artist:"${artist}"`;
    const r = await fetch("https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=5&query=" + encodeURIComponent(q), {
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (!r.ok) { res.statusCode = 503; return res.end("lookup unavailable"); } // not cached: try again later
    groups = (await r.json())["release-groups"] || [];
  } catch {
    res.statusCode = 503; return res.end("lookup unavailable");
  }

  const best = groups.find((g) => (g.score || 0) >= 85);
  if (!best) return notFound();

  res.statusCode = 302;
  res.setHeader("location", `https://coverartarchive.org/release-group/${best.id}/front-250`);
  res.setHeader("cache-control", "public, s-maxage=2592000, stale-while-revalidate=86400");
  res.end();
};
