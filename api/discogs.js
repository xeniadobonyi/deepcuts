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
  if (url.searchParams.get("find") === "1") return find(url, artist, token, send);
  if (url.searchParams.get("seed") === "1") return seedBundle(url, artist, token, send);
  if (url.searchParams.get("vibe") === "1") return vibeSearch(url, token, send);
  if (url.searchParams.get("follow") === "1") return follow(url, token, send);
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

// ---------- Backup for records MusicBrainz doesn't know (new and underground releases) ----------
const titleOf = (x) => { const t = String(x.title || ""), i = t.indexOf(" - "); return i >= 0 ? t.slice(i + 3) : t; };
const artistOf = (x) => { const t = String(x.title || ""), i = t.indexOf(" - "); return (i >= 0 ? t.slice(0, i) : "").replace(/\s+\(\d+\)$/, "").replace(/\*$/, ""); };
const plainName = (n) => String(n || "").replace(/\s+\(\d+\)$/, "").replace(/\*$/, "").trim();

// Search Discogs for "artist – title", where the title can be a release or a track on one.
async function lookup(artist, title, token) {
  const tries = title
    ? [{ artist, release_title: title }, { artist, track: title }, { q: artist + " " + title }]
    : [{ artist }, { q: artist }];
  for (const t of tries) {
    const r = await dcGet("/database/search?" + new URLSearchParams({ type: "release", per_page: "10", ...t }), token);
    if (r.status === 401 || r.status === 403) return { disabled: true };
    if (!r.ok) return { busy: true };
    const list = ((await r.json()).results || []).filter((x) => !artist || squash(artistOf(x)).includes(squash(artist).slice(0, 6)) || t.q);
    if (list.length) return { list, viaTrack: !!t.track };
  }
  return { list: [] };
}

//   /api/discogs?find=1&artist=…&title=…   → {enabled, items: [{artist, title, year, format, song}]}  (suggestions)
async function find(url, artist, token, send) {
  const title = clean(url.searchParams.get("title"));
  if (!artist) return send(400, { enabled: true, error: "artist is required" });
  try {
    const f = await lookup(artist, title, token);
    if (f.disabled) return send(200, { enabled: false }, "public, s-maxage=60");
    if (f.busy) return send(503, { enabled: true, items: null });
    const seen = new Set(), items = [];
    for (const x of f.list) {
      const a = artistOf(x), t = titleOf(x), k = squash(a + t);
      if (!a || !t || seen.has(k)) continue; seen.add(k);
      items.push({ artist: a, title: t, year: String(x.year || ""), format: (x.format || []).find((v) => /LP|EP|Album|Single|12"|7"|Cassette|File/.test(v)) || "", song: f.viaTrack ? title : "" });
      if (items.length === 4) break;
    }
    return send(200, { enabled: true, items }, "public, s-maxage=21600");
  } catch { return send(503, { enabled: true, items: null }); }
}

//   /api/discogs?seed=1&artist=…&title=…   → the record plus real neighbours to dig from:
//   {enabled, found, release: {artist, title, year, label, styles, genres, song}, label: [...], people: [{name, role, records: [...]}]}
async function seedBundle(url, artist, token, send) {
  const title = clean(url.searchParams.get("title"));
  if (!artist) return send(400, { enabled: true, error: "artist is required" });
  try {
    const f = await lookup(artist, title, token);
    if (f.disabled) return send(200, { enabled: false }, "public, s-maxage=60");
    if (f.busy) return send(503, { enabled: true, found: null });
    if (!f.list.length) return send(200, { enabled: true, found: false }, "public, s-maxage=21600");
    // Prefer the original release over reissues: the earliest year among the matches.
    const best = f.list.slice().sort((a, b) => (+a.year || 9999) - (+b.year || 9999))[0];
    const rr = await dcGet("/releases/" + best.id, token);
    if (!rr.ok) return send(503, { enabled: true, found: null });
    const rel = await rr.json();
    const mainArtists = (rel.artists || []).map((a) => plainName(a.name));
    const lab = (rel.labels || []).find((l) => l.id && !/not on label/i.test(l.name || ""));
    const release = {
      artist: mainArtists.join(", ") || artistOf(best), title: rel.title || titleOf(best), year: String(rel.year || best.year || ""),
      label: lab ? plainName(lab.name) : "", styles: rel.styles || [], genres: rel.genres || [], song: f.viaTrack ? title : "",
      url: rel.uri || "https://www.discogs.com/release/" + rel.id
    };
    const own = new Set(mainArtists.map(squash));
    const rec = (x, extra = {}) => ({ artist: plainName(x.artist), title: x.title, year: String(x.year || ""), id: x.id, ...extra });
    // The label's other records, nearest in time first.
    let label = [];
    if (lab) {
      const lr = await dcGet("/labels/" + lab.id + "/releases?per_page=60", token);
      if (lr.ok) {
        const seen = new Set();
        label = ((await lr.json()).releases || [])
          .filter((x) => x.artist && x.title && !own.has(squash(plainName(x.artist))) && !/various/i.test(x.artist))
          .filter((x) => { const k = squash(plainName(x.artist) + x.title); return !seen.has(k) && seen.add(k); })
          .sort((a, b) => Math.abs((+a.year || 0) - (+release.year || 0)) - Math.abs((+b.year || 0) - (+release.year || 0)))
          .slice(0, 20).map((x) => rec(x, { label: release.label }));
      }
    }
    // People credited on the record (producers, remixers, players), and their own records.
    const credited = [...(rel.extraartists || []), ...(rel.tracklist || []).flatMap((t) => t.extraartists || [])]
      .filter((p) => p.id && !own.has(squash(plainName(p.name))) && !/design|artwork|photo|layout|master|lacquer|liner|cover/i.test(p.role || ""));
    const uniq = credited.filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i).slice(0, 2);
    const people = [];
    for (const p of uniq) {
      const ar = await dcGet("/artists/" + p.id + "/releases?per_page=30&sort=year&sort_order=desc", token);
      if (!ar.ok) continue;
      const records = ((await ar.json()).releases || []).filter((x) => /main/i.test(x.role || "") && x.title)
        .slice(0, 6).map((x) => rec({ ...x, artist: x.artist || p.name }));
      if (records.length) people.push({ name: plainName(p.name), role: p.role || "credited", records });
    }
    return send(200, { enabled: true, found: true, release, label, people }, "public, s-maxage=21600");
  } catch { return send(503, { enabled: true, found: null }); }
}

// ---------- Vibe digs: real records by genre, style, country and years ----------
//   /api/discogs?vibe=1&genre=Rock&style=Soft Rock&country=US&from=1970&to=1979
//   → {enabled, records: [{artist, title, year, country, styles, have, want, id, url}]}
// Albums only (no singles or compilations), one entry per album with owners and wants summed over its pressings.
async function vibeSearch(url, token, send) {
  const g = (k) => clean(url.searchParams.get(k)).slice(0, 60);
  const genre = g("genre"), style = g("style"), country = g("country"), label = g("label");
  const from = parseInt(g("from"), 10) || 0, to = parseInt(g("to"), 10) || from;
  if (!genre && !style && !label) return send(400, { enabled: true, error: "genre, style or label is required" });
  const base = { type: "release", per_page: "100", ...(genre ? { genre } : {}), ...(style ? { style } : {}), ...(country ? { country } : {}), ...(label ? { label } : {}) };
  const inRange = (y) => !from || (+y >= from && +y <= (to || from));
  try {
    let results = [];
    // Try the years as a range first; if Discogs doesn't take it, search without years and filter here.
    const tries = from ? [{ ...base, year: from === to ? String(from) : from + "-" + to }, base] : [base];
    for (const t of tries) {
      for (const page of ["1", "2"]) {
        const r = await dcGet("/database/search?" + new URLSearchParams({ ...t, page }), token);
        if (r.status === 401 || r.status === 403) return send(200, { enabled: false }, "public, s-maxage=60");
        if (!r.ok) break;
        const d = await r.json();
        results = results.concat(d.results || []);
        if ((d.pagination?.pages || 1) <= 1) break;
      }
      if (results.filter((x) => inRange(x.year)).length >= 20) break;
    }
    const albums = new Map();
    for (const x of results) {
      const f = (x.format || []).join(" ");
      if (!/LP|Album/i.test(f) || /Compilation|Single|Promo|Sampler/i.test(f) || !inRange(x.year)) continue;
      const a = artistOf(x), t = titleOf(x);
      if (!a || !t || /^various$/i.test(a)) continue;
      const k = x.master_id ? "m" + x.master_id : squash(a + t);
      const e = albums.get(k) || { artist: a, title: t, year: String(x.year || ""), country: x.country || "", styles: x.style || [], have: 0, want: 0, id: x.id,
        url: x.master_id ? "https://www.discogs.com/master/" + x.master_id : "https://www.discogs.com" + (x.uri || "/release/" + x.id) };
      e.have += x.community?.have || 0; e.want += x.community?.want || 0;
      if (x.year && (!e.year || +x.year < +e.year)) e.year = String(x.year);
      albums.set(k, e);
    }
    return send(200, { enabled: true, records: [...albums.values()].slice(0, 120) }, "public, s-maxage=21600");
  } catch { return send(503, { enabled: true, records: null }); }
}

// ---------- Following one thread: a person or a label ----------
//   /api/discogs?follow=1&kind=artist|label&name=…&year=1980
//   → {enabled, found, name, kind, records: [{artist, title, year, id, role}]}
// A person: the records they made, produced or played on (Discogs' credits for that artist).
// A label: its records, nearest in time to the year given. Albums only where Discogs says so; no compilations.
async function follow(url, token, send) {
  const kind = url.searchParams.get("kind") === "label" ? "label" : "artist";
  const name = clean(url.searchParams.get("name"));
  const year = +clean(url.searchParams.get("year")) || 0;
  if (!name) return send(400, { enabled: true, error: "name is required" });
  try {
    const sr = await dcGet("/database/search?" + new URLSearchParams({ type: kind, q: name, per_page: "10" }), token);
    if (!sr.ok) return send(503, { enabled: true, found: null });
    const hits = (await sr.json()).results || [];
    const hit = hits.find((x) => squash(plainName(x.title)) === squash(name)) || hits.find((x) => squash(plainName(x.title)).startsWith(squash(name)) && squash(name).length >= 5);
    if (!hit) return send(200, { enabled: true, found: false }, "public, s-maxage=21600");
    const seen = new Set(), records = [];
    const keep = (x, role) => {
      const artist = plainName(x.artist || ""), title = String(x.title || "").trim();
      if (!artist || !title || /^various/i.test(artist)) return;
      if (/\b(single|compilation|comp|mixed|promo|unofficial)\b/i.test(x.format || "")) return;
      if (/greatest hits|best of|anthology|collection|essential|remixes|live at|in concert/i.test(title)) return;
      const k = squash(artist) + "|" + squash(title.replace(/\s*[\(\[][^)\]]*[\)\]]/g, ""));
      if (seen.has(k)) return; seen.add(k);
      records.push({ artist, title, year: String(x.year || ""), id: x.main_release || x.id, role });
    };
    if (kind === "artist") {
      const ar = await dcGet("/artists/" + hit.id + "/releases?per_page=100&sort=year&sort_order=asc", token);
      if (!ar.ok) return send(503, { enabled: true, found: null });
      for (const x of (await ar.json()).releases || []) {
        const role = String(x.role || "");
        if (/^(Main|Producer|Production|Appearance|Co-producer)$/i.test(role)) keep(x, /main/i.test(role) ? "made" : /produc/i.test(role) ? "produced" : "played on");
      }
      // Their production and session work first: that's where the surprising links are.
      records.sort((a, b) => (a.role === "made") - (b.role === "made"));
    } else {
      const lr = await dcGet("/labels/" + hit.id + "/releases?per_page=100", token);
      if (!lr.ok) return send(503, { enabled: true, found: null });
      for (const x of (await lr.json()).releases || []) keep(x, "released");
      if (year) records.sort((a, b) => Math.abs((+a.year || 0) - year) - Math.abs((+b.year || 0) - year));
    }
    return send(200, { enabled: true, found: records.length > 0, name: plainName(hit.title), kind, records: records.slice(0, 60) }, "public, s-maxage=21600");
  } catch { return send(503, { enabled: true, found: null }); }
}
