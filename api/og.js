// Deep Cuts preview pictures (Vercel Function): /api/og?d=<crate data> → a 1200×630 PNG of the crate.
// Without a crate it draws the site's own preview. Made with @vercel/og, in the site's look:
// light grey, black, neon pink. No outside images are fetched, so it can't fail on a slow cover server.

const { readCrate } = require("./_crate.js");

// Every box is a flex box: the image renderer needs that for anything holding more than one child.
const h = (type, style, children) => ({ type, props: { style: { display: "flex", ...style }, children } });

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const crate = readCrate(url.searchParams.get("d"));
  const { ImageResponse } = await import("@vercel/og");

  const brand = h("div", { display: "flex", alignItems: "center", gap: 16 }, [
    h("div", { width: 22, height: 22, borderRadius: 11, background: "#ff2d95" }, []),
    h("div", { fontSize: 30, letterSpacing: 1 }, "DEEP CUTS")
  ]);

  let body;
  if (crate) {
    const n = crate.recs.length, size = n > 7 ? 21 : n > 4 ? 28 : 34, gap = n > 7 ? 3 : 6;
    const rows = crate.recs.map((r, i) =>
      h("div", { display: "flex", gap: 18, fontSize: size, lineHeight: 1.25, borderBottom: i < n - 1 ? "2px solid #c9c9c9" : "none", paddingBottom: gap }, [
        h("div", { color: "#ff2d95", width: 46, flexShrink: 0 }, String(i + 1).padStart(2, "0")),
        h("div", { display: "flex", flexGrow: 1, overflow: "hidden", whiteSpace: "nowrap" }, r.artist.toUpperCase() + " — " + r.album),
        h("div", { color: "#5f5f5f", flexShrink: 0 }, r.year || "")
      ]));
    body = [
      h("div", { display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }, [
        brand,
        h("div", { fontSize: 26, color: "#5f5f5f" }, n + " record" + (n === 1 ? "" : "s"))
      ]),
      h("div", { fontSize: n > 7 ? 54 : 64, lineHeight: 1.1, marginTop: 14, flexShrink: 0 }, crate.name),
      h("div", { display: "flex", flexDirection: "column", gap, marginTop: 18, padding: n > 7 ? "14px 24px" : "20px 26px", border: "4px solid #111111", background: "#ffffff" }, rows)
    ];
  } else {
    // The site's own preview: the name and an invitation, white on neon pink.
    const img = new ImageResponse(
      h("div", { width: "100%", height: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, background: "#ff2d95", color: "#ffffff" }, [
        h("div", { fontSize: 150, letterSpacing: -2 }, "Deep Cuts"),
        h("div", { fontSize: 64 }, "Pick a record.")
      ]),
      { width: 1200, height: 630 }
    );
    const buf = Buffer.from(await img.arrayBuffer());
    res.statusCode = 200;
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, s-maxage=604800, stale-while-revalidate=86400");
    return res.end(buf);
  }

  const img = new ImageResponse(
    h("div", { width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "48px 60px", background: "#ececec", color: "#111111" }, body),
    { width: 1200, height: 630 }
  );
  const buf = Buffer.from(await img.arrayBuffer());
  res.statusCode = 200;
  res.setHeader("content-type", "image/png");
  res.setHeader("cache-control", "public, s-maxage=604800, stale-while-revalidate=86400");
  res.end(buf);
};
