// Deep Cuts API (Vercel Function): forwards dig requests to Claude and streams the answer back.
// The Anthropic API key is read from the ANTHROPIC_API_KEY environment variable and never reaches the browser.

const MAX_PROMPT_CHARS = 12000;
const LIMIT_PER_HOUR = Number(process.env.DIGS_PER_HOUR || 20);
const hits = new Map(); // simple per-visitor limit; resets when the function restarts

function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= LIMIT_PER_HOUR) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

function sendJSON(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJSON(res, 405, { error: { message: "Use POST." } });
  if (!process.env.ANTHROPIC_API_KEY) return sendJSON(res, 500, { error: { message: "Server is missing its API key." } });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return sendJSON(res, 429, { error: { message: "Too many digs this hour. Try again later." } });

  let prompt;
  try { ({ prompt } = await readBody(req)); } catch { return sendJSON(res, 400, { error: { message: "Send JSON: {\"prompt\": \"...\"}" } }); }
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
    return sendJSON(res, 400, { error: { message: "Prompt missing or too long." } });
  }

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.MODEL || "claude-sonnet-5-5",
        max_tokens: 3000,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    return sendJSON(res, 502, { error: { message: "Couldn't reach Claude." } });
  }

  if (!upstream.ok) {
    // Don't pass an invalid-key error through as the visitor's fault.
    const status = upstream.status === 401 || upstream.status === 403 ? 500 : upstream.status;
    let detail = {};
    try { detail = await upstream.json(); } catch {}
    return sendJSON(res, status, { error: { message: detail?.error?.message || "Claude returned an error." } });
  }

  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch {
    // Visitor left or the stream broke; nothing more to send.
  }
  res.end();
};
