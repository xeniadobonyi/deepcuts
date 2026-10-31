// Deep Cuts API: a small Cloudflare Worker that forwards dig requests to Claude.
// The Anthropic API key lives only here, as a secret, never in the website.

const MAX_PROMPT_CHARS = 12000;

function cors(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(status, data, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "content-type": "application/json" } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(env, origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json(405, { error: { message: "Use POST." } }, headers);

    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(origin)) return json(403, { error: { message: "Origin not allowed." } }, headers);

    let prompt;
    try { ({ prompt } = await request.json()); } catch { return json(400, { error: { message: "Send JSON: {\"prompt\": \"...\"}" } }, headers); }
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
      return json(400, { error: { message: "Prompt missing or too long." } }, headers);
    }

    // Optional per-visitor limit, using Cloudflare's rate limiting binding when configured.
    if (env.DIG_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.DIG_LIMITER.limit({ key: ip });
      if (!success) return json(429, { error: { message: "Too many digs. Try again later." } }, headers);
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.MODEL || "claude-sonnet-5-5",
        max_tokens: 3000,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return new Response(text, { status: upstream.status, headers: { ...headers, "content-type": "application/json" } });
    }

    // Stream Claude's answer straight back to the page.
    return new Response(upstream.body, {
      status: 200,
      headers: { ...headers, "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  },
};
