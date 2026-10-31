// Shared by /api/crate and /api/og: read a crate from a share link, strictly.
// The link holds base64url JSON: {"v":1,"n":"name","r":[[artist, album, year, mbid], …]} (at most 10 records).
// Links come from anyone, so everything is clipped, cleaned and only ever used as text.

const DATA_RE = /^[A-Za-z0-9_-]{8,8000}$/;

function readCrate(d) {
  if (!DATA_RE.test(String(d || ""))) return null;
  try {
    const json = Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const data = JSON.parse(json);
    const clip = (x, n) => String(x ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n);
    const recs = (Array.isArray(data?.r) ? data.r : []).slice(0, 10).filter(Array.isArray)
      .map((r) => ({ artist: clip(r[0], 120), album: clip(r[1], 160), year: clip(r[2], 4).replace(/\D/g, "") }))
      .filter((r) => r.artist && r.album);
    return recs.length ? { name: clip(data.n, 60) || "A crate", recs } : null;
  } catch {
    return null;
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = { readCrate, escapeHtml, DATA_RE };
