// Deep Cuts MusicBrainz proxy (Vercel Function): read-only lookups on the MusicBrainz API,
// with Deep Cuts' name attached as MusicBrainz asks, and cached by Vercel's CDN for a week.
//   /api/mb?e=release-group&query=…      search
//   /api/mb?e=artist/<mbid>&inc=…        lookup
//   /api/mb?e=release&label=<mbid>&…     browse
// The page calls this at most about once per second, which is MusicBrainz's limit.

const UA = "DeepCuts/1.0 (https://github.com/xeniadobonyi/deepcuts)";
const ENTITY = /^(release-group|release|artist|label|recording)(\/[0-9a-f-]{36})?$/;
const PARAMS = new Set(["query", "inc", "limit", "offset", "artist", "label", "release-group", "type", "status"]);

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const entity = url.searchParams.get("e") || "";
  if (!ENTITY.test(entity)) { res.statusCode = 400; return res.end("Unsupported lookup"); }

  const qs = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (PARAMS.has(k)) qs.set(k, String(v).slice(0, 300));
  qs.set("fmt", "json");

  let r;
  try {
    r = await fetch(`https://musicbrainz.org/ws/2/${entity}?${qs}`, { headers: { "user-agent": UA, accept: "application/json" } });
  } catch {
    res.statusCode = 503; return res.end("lookup unavailable");
  }
  const body = await r.text();
  res.statusCode = r.ok ? 200 : r.status === 404 ? 404 : 503;
  res.setHeader("content-type", "application/json");
  if (r.ok) res.setHeader("cache-control", "public, s-maxage=604800, stale-while-revalidate=86400");
  else if (r.status === 404) res.setHeader("cache-control", "public, s-maxage=86400");
  res.end(body);
};
