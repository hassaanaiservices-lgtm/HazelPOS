// "Hear everything, then fix it": DeepSeek reads the whole voice-note transcript with the menu and writes what the
// customer most likely said, in Roman Urdu. Instructions: rag/prompts/voice-cleanup.md. One small call (~1 s).
// Returns null if it fails — callers then use the raw transcript.
const fs = require('fs');
const path = require('path');
const { config, paths } = require('../config');
const { readPos } = require('../loaders/pos-db');
const { chatJson } = require('./deepseek');

async function cleanupTranscript(raw, pos) {
  if (!String(raw || '').trim()) return null;
  pos = pos || readPos(paths.posDb, config.data);
  const menu = pos.menu.filter(p => p.active).map(p => p.name + (p.sizes?.length ? ` (${p.sizes.map(s => s.name).join('/')})` : '')).join(', ');
  const system = fs.readFileSync(path.join(paths.prompts, 'voice-cleanup.md'), 'utf8')
    .replace('{{RESTAURANT_NAME}}', pos.restaurant.name || 'the restaurant').replace('{{MENU}}', menu);
  try {
    const r = await chatJson({ ...config.llm, max_reply_tokens: 300 }, [{ role: 'system', content: system }, { role: 'user', content: raw }]);
    const text = String(r.json?.text || '').trim();
    if (!text) return null;
    return { text, confidence: ['high', 'medium', 'low'].includes(r.json.confidence) ? r.json.confidence : 'medium', ms: r.ms, usage: r.usage };
  } catch { return null; }
}

module.exports = { cleanupTranscript };
