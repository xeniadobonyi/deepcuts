// Deep Cuts rarity check (Vercel Function): how many Discogs members own and want an album.
//   /api/discogs?artist=…&album=…  → JSON {enabled, found, have, want, url}
// "have" and "want" are summed over every pressing of the album found on Discogs.
// Needs a free personal token from discogs.com (Settings → Developers) in the DISCOGS_TOKEN
// environment variable. Without it, the site works as before and simply skips this check.
// Discogs' API terms: data shown must be at most 6 hours old, so answers are cached for 6 hours.

const UA = "DeepCuts/1.0 +https://github.com/xeniadobonyi/deepcuts";
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 200);
const dcGet = async (path, token) => {
  const ask = () => fetch("https://api.discogs.com" + path, { headers: { "user-agent": UA, authorization: "Discogs token=" + token, accept: "application/json" } });
  let r = await ask();
  if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); r = await ask(); }
  return r;
};
const squash = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const artist = clean(url.searchParams.get("artist"));
  const album = clean(url.searchParams.get("album"));
  const send = (status, data, cache) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    if (cache) res.setHeader("cache-control", cache);
    res.end(JSON.stringify(data));
  };
  const token = process.env.DISCOGS_TOKEN;
  if (!token) return send(200, { enabled: false }, "public, s-maxage=300");
  if (url.searchParams.get("credits") === "1") return credits(url, artist, album, token, send);
  if (!artist || !album) return send(400, { enabled: true, error: "artist and album are required" });

  let data;
  try {
    const qs = new URLSearchParams({ type: "release", artist, release_title: album, per_page: "100" });
    const ask = () => fetch("https://api.discogs.com/database/search?" + qs, {
      headers: { "user-agent": UA, authorization: "Discogs token=" + token, accept: "application/json" },
    });
    let r = await ask();
    // Discogs allows about 60 requests a minute per token; when busy, wait and try once more.
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); r = await ask(); }
    if (r.status === 401 || r.status === 403) return send(200, { enabled: false, error: "Discogs token not accepted" }, "public, s-maxage=60");
    if (!r.ok) return send(503, { enabled: true, found: null }); // not cached: try again later
    data = await r.json();
  } catch {
    return send(503, { enabled: true, found: null });
  }

  // Search results are titled "Artist - Album". Keep the ones that are this album, then group pressings by master.
  const want = squash(album);
  const hits = (data.results || []).filter((x) => {
    const t = String(x.title || ""), i = t.indexOf(" - ");
    const title = squash(i >= 0 ? t.slice(i + 3) : t);
    return title === want || (want.length >= 6 && (title.startsWith(want) || want.startsWith(title)) && Math.min(title.length, want.length) >= 6);
  });
  if (!hits.length) return send(200, { enabled: true, found: false }, "public, s-maxage=21600");

  const groups = new Map();
  for (const x of hits) {
    const k = x.master_id ? "m" + x.master_id : "r" + x.id;
    const g = groups.get(k) || { have: 0, want: 0, versions: 0, url: x.master_id ? "https://www.discogs.com/master/" + x.master_id : "https://www.discogs.com" + (x.uri || "/release/" + x.id) };
    g.have += x.community?.have || 0; g.want += x.community?.want || 0; g.versions++;
    groups.set(k, g);
  }
  const best = [...groups.values()].sort((a, b) => b.have - a.have)[0];
  // More than 100 pressings means a very widely pressed record: the counts are a floor.
  const more = (data.pagination?.items || 0) > 100;
  return send(200, { enabled: true, found: true, have: best.have, want: best.want, versions: best.versions, many: more, url: best.url },
    "public, s-maxage=21600");
};

// Credits: /api/discogs?credits=1&artist=…&album=…   (or &master=<id> when already known)
//   → JSON {enabled, found, producers: [names], engineers: [names]}
// Read from the album's main release on Discogs (credits are CC0 data), album-wide and per track.
// The album's own artists are left out, so self-produced records don't count.
async function credits(url, artist, album, token, send) {
  const stripNum = (n) => String(n || "").replace(/\s+\(\d+\)$/, "").trim();
  try {
    let masterId = (url.searchParams.get("master") || "").replace(/\D/g, "");
    let releaseId = "";
    if (!masterId) {
      if (!artist || !album) return send(400, { enabled: true, error: "artist and album are required" });
      const qs = new URLSearchParams({ type: "release", artist, release_title: album, per_page: "25" });
      const r = await dcGet("/database/search?" + qs, token);
      if (r.status === 401 || r.status === 403) return send(200, { enabled: false }, "public, s-maxage=60");
      if (!r.ok) return send(503, { enabled: true, found: null });
      const want = squash(album);
      const hit = ((await r.json()).results || []).find((x) => { const t = String(x.title || ""), i = t.indexOf(" - "); return squash(i >= 0 ? t.slice(i + 3) : t) === want; });
      if (!hit) return send(200, { enabled: true, found: false }, "public, s-maxage=21600");
      if (hit.master_id) masterId = String(hit.master_id); else releaseId = String(hit.id);
    }
    if (masterId) {
      const m = await dcGet("/masters/" + masterId, token);
      if (!m.ok) return send(m.status === 404 ? 200 : 503, { enabled: true, found: m.status === 404 ? false : null });
      releaseId = String((await m.json()).main_release || "");
    }
    if (!releaseId) return send(200, { enabled: true, found: false }, "public, s-maxage=21600");
    const rr = await dcGet("/releases/" + releaseId, token);
    if (!rr.ok) return send(rr.status === 404 ? 200 : 503, { enabled: true, found: rr.status === 404 ? false : null });
    const rel = await rr.json();
    const own = new Set((rel.artists || []).map((a) => squash(stripNum(a.name))));
    const people = [...(rel.extraartists || []), ...(rel.tracklist || []).flatMap((t) => t.extraartists || [])];
    const pick = (re, not) => [...new Set(people.filter((p) => re.test(p.role || "") && !(not && not.test(p.role || "")))
      .map((p) => stripNum(p.name)).filter((n) => n && !own.has(squash(n)) && !/^various$/i.test(n)))].slice(0, 8);
    const producers = pick(/produc/i, /executive/i);
    const engineers = pick(/engineer|recorded by|mixed by/i, /mastered|lacquer|assistant/i).filter((n) => !producers.includes(n));
    return send(200, { enabled: true, found: true, producers, engineers }, "public, s-maxage=21600");
  } catch {
    return send(503, { enabled: true, found: null });
  }
}
