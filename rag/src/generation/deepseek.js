// DeepSeek chat client (OpenAI-compatible API). Thinking off, JSON output, timeout + one retry.
// Returns the parsed JSON plus token usage and time, so every call can be logged and costed.
const fs = require('fs');
const path = require('path');

const ENV = path.join(__dirname, '..', '..', '..', '.env');
if (!process.env.DEEPSEEK_API_KEY && fs.existsSync(ENV)) process.loadEnvFile(ENV);

async function once(cfg, messages, signal) {
  const t0 = Date.now();
  const r = await fetch(cfg.base_url + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model, messages, max_tokens: cfg.max_reply_tokens,
      thinking: { type: cfg.thinking }, response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.any([AbortSignal.timeout(cfg.timeout_ms), signal].filter(Boolean)),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`DeepSeek HTTP ${r.status}: ${body.error?.message || 'no details'}`), { retry: r.status === 429 || r.status >= 500 });
  const content = body.choices?.[0]?.message?.content || '';
  let json;
  try { json = JSON.parse(content); } catch { throw Object.assign(new Error('DeepSeek did not return valid JSON'), { retry: true, content }); }
  return { json, usage: body.usage || {}, ms: Date.now() - t0, model: body.model };
}

// Hedged call: if no answer after cfg.hedge_after_ms, send the same request again; the first good answer wins and the
// other is cancelled. DeepSeek is usually ~1.3 s but now and then one call takes 5-13 s.
function hedged(cfg, messages) {
  return new Promise((resolve, reject) => {
    const ctrls = [];
    let failed = 0, launched = 0, settled = false;
    const launch = () => {
      if (settled) return;
      const c = new AbortController(); ctrls.push(c); launched++;
      once(cfg, messages, c.signal).then(r => {
        if (settled) return;
        settled = true; clearTimeout(timer); ctrls.forEach(x => x !== c && x.abort());
        resolve({ ...r, hedged: launched > 1 });
      }, e => {
        if (settled) return;
        if (++failed === launched && (launched === 2 || !cfg.hedge_after_ms)) { settled = true; clearTimeout(timer); reject(e); }
        else if (launched === 1) { clearTimeout(timer); launch(); } // first failed before the hedge: try the second now
      });
    };
    const timer = cfg.hedge_after_ms ? setTimeout(launch, cfg.hedge_after_ms) : null;
    launch();
  });
}

async function chatJson(cfg, messages) {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is not set in .env');
  let lastErr;
  for (let attempt = 0; attempt <= cfg.max_retries; attempt++) {
    try { return { ...(await hedged(cfg, messages)), attempts: attempt + 1 }; }
    catch (e) { lastErr = e; if (!(e.retry || e.name === 'TimeoutError')) break; }
  }
  throw lastErr;
}

module.exports = { chatJson };
