// deep cuts AI (Vercel Function): sends each request to Claude or Groq and streams the answer back.
// Which model answers depends on the job the page names:
//   "pick"  (choosing the five records and writing the reasons) → Claude first (Sonnet 5.5), Groq as backup
//   "plan", "taste" (behind-the-scenes calls)                  → Groq first, Claude as backup
// If one is down, busy, out of credit or over its spend limit, the other answers instead.
// Keys live only in Vercel: ANTHROPIC_API_KEY, GROQ_API_KEY. Optional: CLAUDE_MODEL, MODEL (Groq).
// The answer is re-sent in one event format the page already reads, whichever model wrote it.

const MAX_PROMPT_CHARS = 12000;
// Per-visitor daily limit on AI requests. A dig makes one or two, so 150 covers the page's 50 digs a day.
// Set REQUESTS_PER_DAY in Vercel to change it (0 turns it off).
const REQUESTS_PER_DAY = Number(process.env.REQUESTS_PER_DAY ?? 150);
const hits = new Map(); // best-effort per-visitor limit; resets when the function restarts

function dayKey() { return new Date().toISOString().slice(0, 10); }

function overLimit(ip) {
  if (!REQUESTS_PER_DAY) return false;
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

const SYSTEM = "You are a precise music expert. When asked for JSON, reply with valid JSON only: no markdown, no headings, no extra text.";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

// Claude: one model. Returns { ok: true, read } or { ok: false, why }.
async function tryClaude(prompt) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, why: "no key" };
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      // No temperature: newer Claude models reject it and choose their own.
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 3000, stream: true, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
    });
  } catch { return { ok: false, why: "unreachable" }; }
  if (!r.ok) {
    let msg = ""; try { msg = (await r.json())?.error?.message || ""; } catch {}
    console.error("Claude error", r.status, CLAUDE_MODEL, msg);
    return { ok: false, why: r.status === 429 || r.status === 529 ? "busy" : "error" };
  }
  // Claude streams events like {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}.
  return { ok: true, model: CLAUDE_MODEL, body: r.body, textOf: (ev) => (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" ? ev.delta.text : ""), errOf: (ev) => (ev?.type === "error" ? ev.error?.message || "error" : "") };
}

// Groq: the best model first, then smaller ones, since each has its own allowance on the free tier.
async function tryGroq(prompt) {
  if (!process.env.GROQ_API_KEY) return { ok: false, why: "no key" };
  const models = [...new Set([process.env.MODEL, "openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"].filter(Boolean))];
  let daily = false, minute = false;
  for (const model of models) {
    let r;
    try {
      r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + process.env.GROQ_API_KEY },
        body: JSON.stringify({
          model,
          // gpt-oss models think before answering; keep that short and out of the reply so the answer has room.
          ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : {}),
          max_completion_tokens: 3000,
          temperature: 0.7,
          stream: true,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
        }),
      });
    } catch { return { ok: false, why: "unreachable" }; }
    if (r.ok) return { ok: true, model, body: r.body, textOf: (ev) => ev?.choices?.[0]?.delta?.content || "", errOf: (ev) => (ev?.error ? ev.error.message || "error" : "") };
    let d = {}; try { d = await r.json(); } catch {}
    const msg = String(d?.error?.message || "") + " " + String(d?.error?.code || "");
    console.error("Groq error", r.status, model, msg.trim());
    if (r.status === 429) { if (/per day|\(TPD\)|\(RPD\)/i.test(msg)) daily = true; else minute = true; continue; }
    if ((r.status === 400 || r.status === 404) && /model/i.test(msg)) continue; // model retired or not offered
    return { ok: false, why: "error" };
  }
  return { ok: false, why: minute ? "busy" : daily ? "closed" : "error" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJSON(res, 405, { error: { message: "Use POST." } });
  if (!process.env.GROQ_API_KEY && !process.env.ANTHROPIC_API_KEY) return sendJSON(res, 500, { error: { message: "The server has no AI key yet. Add ANTHROPIC_API_KEY or GROQ_API_KEY in Vercel, then redeploy." } });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (overLimit(ip)) return sendJSON(res, 429, { error: { code: "visitor_limit", message: "You have 50 digs a day, and you've dug a lot today. Come back tomorrow." } });

  let prompt, task;
  try { ({ prompt, task } = await readBody(req)); } catch { return sendJSON(res, 400, { error: { message: "Send JSON: {\"prompt\": \"...\"}" } }); }
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
    return sendJSON(res, 400, { error: { message: "Prompt missing or too long." } });
  }

  const order = task === "plan" || task === "taste" ? [tryGroq, tryClaude] : [tryClaude, tryGroq];
  let got = null; const whys = [];
  for (const attempt of order) {
    const r = await attempt(prompt);
    if (r.ok) { got = r; break; }
    whys.push(r.why);
  }
  if (!got) {
    // Nobody could answer. A per-minute limit clears quickly; a used-up day only tomorrow.
    if (whys.includes("busy")) return sendJSON(res, 429, { error: { code: "busy", message: "The shop is busy right now. Try again in a minute." } });
    if (whys.includes("closed")) return sendJSON(res, 429, { error: { code: "closed_today", message: "The shop is closed for digging until tomorrow." } });
    return sendJSON(res, 502, { error: { code: "busy", message: "The shop is busy right now. Try again in a minute." } });
  }
  console.log("AI answered", JSON.stringify({ task: task || "pick", model: got.model }));

  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("x-dc-model", got.model);

  const reader = got.body.getReader();
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
        if (!data || data === "[DONE]") continue;
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        const text = got.textOf(ev);
        if (text) res.write(delta(text));
        const err = got.errOf(ev);
        if (err) res.write("data: " + JSON.stringify({ type: "error", error: { type: /overload/i.test(err) ? "overloaded_error" : "api_error", message: err } }) + "\n\n");
      }
    }
  } catch {
    // Visitor left or the stream broke; nothing more to send.
  }
  res.end();
};
