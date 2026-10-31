// Deep Cuts API (Vercel Function): sends each dig to Groq's free API and streams the answer back.
// The Groq key is read from the GROQ_API_KEY environment variable and never reaches the browser.
// The answer is re-sent in the same event format the page already reads, so the page needs no changes.

const MAX_PROMPT_CHARS = 12000;
const REQUESTS_PER_DAY = Number(process.env.REQUESTS_PER_DAY || 16); // 5 digs (some need a second request to replace invented albums) plus taste summaries
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
  if (!process.env.GROQ_API_KEY) return sendJSON(res, 500, { error: { message: "The server has no Groq key yet. Add GROQ_API_KEY in Vercel, then redeploy." } });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (overLimit(ip)) return sendJSON(res, 429, { error: { message: "You've used today's free digs. Come back tomorrow." } });

  let prompt;
  try { ({ prompt } = await readBody(req)); } catch { return sendJSON(res, 400, { error: { message: "Send JSON: {\"prompt\": \"...\"}" } }); }
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
    return sendJSON(res, 400, { error: { message: "Prompt missing or too long." } });
  }

  // Try the chosen model first; if Groq has retired it or doesn't offer it, fall back to the next one.
  // Llama 3.3 70B was shut down by Groq on Aug 16, 2026; gpt-oss-120b is its recommended replacement.
  const models = [...new Set([process.env.MODEL, "openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"].filter(Boolean))];
  let upstream, detail = {};
  for (const model of models) {
    try {
      upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + process.env.GROQ_API_KEY },
        body: JSON.stringify({
          model,
          // gpt-oss models think before answering; keep that short and out of the reply so the answer has room.
          ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : {}),
          max_completion_tokens: 8000,
          temperature: 0.7,
          stream: true,
          messages: [
            { role: "system", content: "You are a precise music expert. When asked for JSON, reply with valid JSON only: no markdown, no headings, no extra text." },
            { role: "user", content: prompt },
          ],
        }),
      });
    } catch {
      return sendJSON(res, 502, { error: { message: "Couldn't reach the AI service." } });
    }
    if (upstream.ok) break;
    detail = {};
    try { detail = await upstream.json(); } catch {}
    const msg = String(detail?.error?.message || "") + " " + String(detail?.error?.code || "");
    const modelProblem = (upstream.status === 400 || upstream.status === 404) && /model/i.test(msg);
    console.error("Groq error", upstream.status, model, msg.trim());
    if (!modelProblem) break;
  }

  if (!upstream.ok) {
    // Groq's own limit is shared by every visitor: when it is used up, say so plainly.
    if (upstream.status === 429) return sendJSON(res, 429, { error: { message: "Today's free digs are used up. Come back tomorrow." } });
    if (upstream.status === 401 || upstream.status === 403) return sendJSON(res, 500, { error: { message: "The server's Groq key wasn't accepted. Check GROQ_API_KEY in Vercel, then redeploy." } });
    return sendJSON(res, upstream.status, { error: { message: detail?.error?.message || "The AI service returned an error." } });
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
