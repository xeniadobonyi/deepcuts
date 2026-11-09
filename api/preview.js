// deep cuts previews (Vercel Function): finds a 30-second preview of a song so the turntable can play it.
//   /api/preview?artist=…&song=…&album=…
// Tries, in order:
//   1. Deezer, the exact song
//   2. Apple (iTunes Search), the exact song
//   3. another track from the same album (Deezer, then Apple): previews "side A, track 1" instead
// Only a real match counts (same artist, same song or album title), so it never plays a cover or a lookalike.
// No keys are needed. Previews are streamed by Deezer and Apple themselves; nothing is stored here.

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 200);
// Loose comparison: ignores case, accents, punctuation, "(Remastered)", "- 2011 Remaster", "The".
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\s*[\(\[][^)\]]*[\)\]]/g, " ").replace(/\s+-\s+.*(remaster|version|mix|edit|live|mono|stereo).*$/i, "")
  .replace(/^the\s+/, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const sameArtist = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
const sameTitle = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 6 && (x.startsWith(y) || y.startsWith(x)))); };

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "DeepCuts/1.0 (+https://digdeepcuts.com)" } });
  if (!r.ok) throw new Error("status " + r.status);
  return r.json();
}

// ---- Deezer ----
async function deezerSong(artist, song) {
  const d = await getJSON("https://api.deezer.com/search?limit=25&q=" + encodeURIComponent(`artist:"${artist}" track:"${song}"`));
  const t = (d.data || []).find((x) => x.preview && sameArtist(x.artist?.name, artist) && (sameTitle(x.title, song) || sameTitle(x.title_short, song)));
  return t ? { preview: t.preview, title: t.title_short || t.title, artist: t.artist?.name, album: t.album?.title, link: t.link, source: "Deezer" } : null;
}
async function deezerAlbum(artist, album) {
  const d = await getJSON("https://api.deezer.com/search/album?limit=10&q=" + encodeURIComponent(`artist:"${artist}" album:"${album}"`));
  const a = (d.data || []).find((x) => sameArtist(x.artist?.name, artist) && sameTitle(x.title, album));
  if (!a) return null;
  const tr = await getJSON("https://api.deezer.com/album/" + a.id + "/tracks?limit=50");
  const t = (tr.data || []).find((x) => x.preview);
  return t ? { preview: t.preview, title: t.title_short || t.title, artist: a.artist?.name, album: a.title, link: t.link || a.link, source: "Deezer", fallback: true } : null;
}

// ---- Apple (iTunes Search API) ----
async function appleSongs(term) {
  const d = await getJSON("https://itunes.apple.com/search?media=music&entity=song&limit=50&term=" + encodeURIComponent(term));
  return (d.results || []).filter((x) => x.previewUrl);
}
async function appleSong(artist, song) {
  const t = (await appleSongs(artist + " " + song)).find((x) => sameArtist(x.artistName, artist) && sameTitle(x.trackName, song));
  return t ? { preview: t.previewUrl, title: t.trackName, artist: t.artistName, album: t.collectionName, link: t.trackViewUrl, source: "Apple Music" } : null;
}
async function appleAlbum(artist, album) {
  const tracks = (await appleSongs(artist + " " + album)).filter((x) => sameArtist(x.artistName, artist) && sameTitle(x.collectionName, album))
    .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 99) - (b.trackNumber || 99));
  const t = tracks[0];
  return t ? { preview: t.previewUrl, title: t.trackName, artist: t.artistName, album: t.collectionName, link: t.trackViewUrl, source: "Apple Music", fallback: true } : null;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const artist = clean(url.searchParams.get("artist")), song = clean(url.searchParams.get("song")), album = clean(url.searchParams.get("album"));
  const send = (code, body, cache) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (cache) res.setHeader("cache-control", cache);
    res.end(JSON.stringify(body));
  };
  if (!artist || (!song && !album)) return send(400, { error: "artist and song or album required" });

  const steps = [
    song && (() => deezerSong(artist, song)),
    song && (() => appleSong(artist, song)),
    album && (() => deezerAlbum(artist, album)),
    album && (() => appleAlbum(artist, album)),
  ].filter(Boolean);
  let failures = 0;
  for (const step of steps) {
    try {
      const hit = await step();
      // Deezer preview links are signed and expire after a while, so they're cached for an hour only.
      if (hit) return send(200, { found: true, ...hit }, hit.source === "Deezer" ? "public, s-maxage=3600" : "public, s-maxage=86400");
    } catch { failures++; }
  }
  // Nothing anywhere: remember that for a day. If the services themselves failed, don't remember anything.
  if (failures === steps.length) return send(503, { found: null });
  return send(200, { found: false }, "public, s-maxage=86400");
};
