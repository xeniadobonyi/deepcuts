// Deep Cuts crate links (Vercel Function), reached as /c/<data> (see vercel.json).
// Link previews (WhatsApp, Messages, social apps) read this page's tags: the crate's name, its records and a picture.
// People are sent straight on to the crate on the main page (/#crate=<data>).

const { readCrate, escapeHtml, DATA_RE } = require("./_crate.js");

module.exports = function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const d = String(url.searchParams.get("d") || "");
  const ok = DATA_RE.test(d);
  const crate = ok ? readCrate(d) : null;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").replace(/[^A-Za-z0-9.:-]/g, "");
  const origin = host ? "https://" + host : "";

  const title = crate ? crate.name + " · a Deep Cuts crate" : "Deep Cuts: five records you haven't heard, and why";
  const list = crate ? crate.recs.slice(0, 4).map((r) => r.artist + " – " + r.album).join(", ") + (crate.recs.length > 4 ? " and " + (crate.recs.length - 4) + " more" : "") : "";
  const description = crate ? crate.recs.length + " records: " + list + "." : "Five records you haven't heard, and why. Found through real credits, labels and samples.";
  const image = origin + "/api/og" + (crate ? "?d=" + d : "");
  const target = crate ? "/#crate=" + d : "/";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Deep Cuts">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${escapeHtml(origin + "/c/" + (crate ? d : ""))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
<style>body{margin:0;padding:24px;font:16px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;background:#ececec;color:#111}a{color:#1a33d6}</style>
</head>
<body>
<p><a href="${escapeHtml(target)}">Open ${escapeHtml(crate ? crate.name : "Deep Cuts")}</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=86400");
  res.end(html);
};
