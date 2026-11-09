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
// Covers, karaoke and tributes often carry the original artist's name ("Originally performed by Nick Drake"),
// so anything that looks like one is never a match, whatever the name says.
const NOT_ORIGINAL = /karaoke|tribute|originally|made famous|in the style of|as performed|cover version|covers?\b|lullaby|lullabies|instrumental version|piano version|rendition|re-?recorded|sound-?alike|backing track|minus one/i;
// Same artist: identical, or the same name plus an ensemble word ("Bill Evans" = "Bill Evans Trio").
const ENSEMBLE = /^(trio|quartet|quintet|sextet|septet|octet|band|orchestra|group|and(his|her|the)\w*|andfriends|experience|ensemble|bigband)$/;
const sameArtist = (a, b) => {
  if (NOT_ORIGINAL.test(a || "") || NOT_ORIGINAL.test(b || "")) return false;
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [long, short] = x.length > y.length ? [x, y] : [y, x];
  return long.startsWith(short) && ENSEMBLE.test(long.slice(short.length));
};
// The track or album itself must not be a cover, karaoke or tribute release either.
const original = (...names) => !names.some((n) => NOT_ORIGINAL.test(n || ""));
const sameTitle = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 6 && (x.startsWith(y) || y.startsWith(x)))); };

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "DeepCuts/1.0 (+https://digdeepcuts.com)" } });
  if (!r.ok) throw new Error("status " + r.status);
  return r.json();
}

// ---- Deezer ----
async function deezerSong(artist, song, album) {
  const d = await getJSON("https://api.deezer.com/search?limit=25&q=" + encodeURIComponent(`artist:"${artist}" track:"${song}"`));
  const hits = (d.data || []).filter((x) => x.preview && sameArtist(x.artist?.name, artist) && (sameTitle(x.title, song) || sameTitle(x.title_short, song)) && original(x.title, x.album?.title));
  const t = hits.find((x) => album && sameTitle(x.album?.title, album)) || hits[0];
  return t ? { preview: t.preview, title: t.title_short || t.title, artist: t.artist?.name, album: t.album?.title, link: t.link, source: "Deezer" } : null;
}
async function deezerAlbum(artist, album) {
  const d = await getJSON("https://api.deezer.com/search/album?limit=10&q=" + encodeURIComponent(`artist:"${artist}" album:"${album}"`));
  const a = (d.data || []).find((x) => sameArtist(x.artist?.name, artist) && sameTitle(x.title, album) && original(x.title));
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
async function appleSong(artist, song, album) {
  const hits = (await appleSongs(artist + " " + song)).filter((x) => sameArtist(x.artistName, artist) && sameTitle(x.trackName, song) && original(x.trackName, x.collectionName, x.collectionArtistName));
  const t = hits.find((x) => album && sameTitle(x.collectionName, album)) || hits[0];
  return t ? { preview: t.previewUrl, title: t.trackName, artist: t.artistName, album: t.collectionName, link: t.trackViewUrl, source: "Apple Music" } : null;
}
async function appleAlbum(artist, album) {
  const tracks = (await appleSongs(artist + " " + album)).filter((x) => sameArtist(x.artistName, artist) && sameTitle(x.collectionName, album) && original(x.trackName, x.collectionName, x.collectionArtistName))
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
    song && (() => deezerSong(artist, song, album)),
    song && (() => appleSong(artist, song, album)),
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
