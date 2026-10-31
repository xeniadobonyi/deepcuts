// Deep Cuts API (Vercel Function): sends each dig to Groq's free API and streams the answer back.
// The Groq key is read from the GROQ_API_KEY environment variable and never reaches the browser.
// The answer is re-sent in the same event format the page already reads, so the page needs no changes.

const MAX_PROMPT_CHARS = 12000;
const REQUESTS_PER_DAY = Number(process.env.REQUESTS_PER_DAY || 8); // 5 digs plus a few taste summaries
const hits = new Map(); // best-effort per-visitor limit; resets when the function restarts

function dayKey() { return new Date().toISOString().slice(0, 10); }

function overLimit(ip) {
  const today = dayKey();
  const rec = hits.get(ip);
  const n = rec && rec.day === today ? rec.n : 0;
  if (n >= REQUESTS_PER_DAY) return true;
  hits.set(ip, { day: today, n: n + 1 });
  if (hits.size > 20000) hits.clear();
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

function delta(text) {
  return "data: " + JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } }) + "\n\n";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJSON(res, 405, { error: { message: "Use POST." } });
  if (!process.env.GROQ_API_KEY) return sendJSON(res, 500, { error: { message: "Server is missing its API key." } });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (overLimit(ip)) return sendJSON(res, 429, { error: { message: "You've used today's free digs. Come back tomorrow." } });

  let prompt;
  try { ({ prompt } = await readBody(req)); } catch { return sendJSON(res, 400, { error: { message: "Send JSON: {\"prompt\": \"...\"}" } }); }
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
    return sendJSON(res, 400, { error: { message: "Prompt missing or too long." } });
  }

  let upstream;
  try {
    upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.GROQ_API_KEY },
      body: JSON.stringify({
        model: process.env.MODEL || "llama-3.3-70b-versatile",
        max_tokens: 3000,
        temperature: 0.7,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    return sendJSON(res, 502, { error: { message: "Couldn't reach the AI service." } });
  }

  if (!upstream.ok) {
    let detail = {};
    try { detail = await upstream.json(); } catch {}
    // Groq's own limit is shared by every visitor: when it is used up, say so plainly.
    if (upstream.status === 429) return sendJSON(res, 429, { error: { message: "Today's free digs are used up. Come back tomorrow." } });
    const status = upstream.status === 401 || upstream.status === 403 ? 500 : upstream.status;
    return sendJSON(res, status, { error: { message: detail?.error?.message || "The AI service returned an error." } });
  }

  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");

  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        const text = ev?.choices?.[0]?.delta?.content;
        if (text) res.write(delta(text));
        if (ev?.error) res.write("data: " + JSON.stringify({ type: "error", error: { type: "api_error", message: ev.error.message || "" } }) + "\n\n");
      }
    }
  } catch {
    // Visitor left or the stream broke; nothing more to send.
  }
  res.end();
};
