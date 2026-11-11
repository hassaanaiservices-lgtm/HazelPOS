// Speech-to-text for WhatsApp voice notes: Whisper large-v3 hosted by Groq (https://console.groq.com).
// Same speed on every PC (about 1 s for a 30 s note) because nothing runs locally. Needs GROQ_API_KEY in the .env
// at the project root. The audio file is sent to Groq; it is not stored there.
const fs = require('fs');
const path = require('path');

const ENV = path.join(__dirname, '..', '..', '.env');
if (!process.env.GROQ_API_KEY && fs.existsSync(ENV)) process.loadEnvFile(ENV);

const URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const TYPES = { '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };

// cfg = config.stt: { model, language, timeout_ms }
module.exports = function stt(cfg) {
  let state = process.env.GROQ_API_KEY ? 'ready' : 'failed';
  let error = state === 'failed' ? 'GROQ_API_KEY is not set in .env' : '';
  let lastMs = 0;

  async function once(file) {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)], { type: TYPES[path.extname(file).toLowerCase()] || 'audio/ogg' }), path.basename(file));
    form.append('model', cfg.model);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (cfg.language) form.append('language', cfg.language); // auto-detect is unreliable for Urdu
    const r = await fetch(URL, {
      method: 'POST', body: form,
      headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
      signal: AbortSignal.timeout(cfg.timeout_ms),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`Groq ${r.status}: ${body.error?.message || r.statusText}`);
      e.retry = r.status === 429 || r.status >= 500;
      throw e;
    }
    return body;
  }

  // file: path to the audio -> { text, seconds, avg_logprob, ms }; text '' = no speech heard
  async function transcribe(file) {
    if (!process.env.GROQ_API_KEY) { state = 'failed'; error = 'GROQ_API_KEY is not set in .env'; throw new Error(error); }
    const t0 = Date.now();
    let body;
    try { body = await once(file); }
    catch (e) {
      if (!(e.retry || e.name === 'TimeoutError' || e.name === 'TypeError')) { state = 'failed'; error = e.message; throw e; }
      try { body = await once(file); } // one retry for rate limits, server errors and network blips
      catch (e2) { state = 'failed'; error = e2.message; throw e2; }
    }
    const segs = body.segments || [];
    lastMs = Date.now() - t0; state = 'ready'; error = '';
    return {
      text: String(body.text || '').replace(/�/g, '').trim(),
      seconds: body.duration ?? null,
      avg_logprob: segs.length ? +(segs.reduce((s, x) => s + x.avg_logprob, 0) / segs.length).toFixed(3) : null,
      ms: lastMs,
    };
  }

  return { transcribe, status: () => ({ state, error, model: cfg.model, last_ms: lastMs }) };
};
