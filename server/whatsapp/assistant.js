// The WhatsApp assistant: decides, for each customer turn, whether to reply — and replies through the RAG pipeline.
//
// It handles every chat itself and stays on until switched off (globally, or paused for one chat). Besides that it only
// goes quiet outside business hours (if set) and at two safety limits: the loop guard (another bot answering it) and the
// daily cost cap. Staff messages never silence it. Messages that arrived while the POS was offline never reach it.
//
// A customer's quick messages ("hi" / "pizza" / "price?") are merged into one turn. "YES" to an order summary is
// handled by code, never by the LLM. Every turn is logged in wa_bot_log.
const { pick } = require('./messages');
const { cleanupTranscript } = require('../../rag/src/generation/voice-cleanup');

const YES = new Set(['yes', 'ys', 'yess', 'yesss', 'yeah', 'yep', 'yup', 'ok', 'okay', 'ok confirm', 'yes confirm', 'yes please', 'confirm',
  'confirmed', 'done', 'haan', 'han', 'haa', 'ha', 'haanji', 'haan ji', 'han ji', 'ji', 'jee', 'ji haan', 'ji han', 'g', 'theek hai',
  'thik hai', 'theek', 'confirm karo', 'confirm kar do', 'confirm krdo', 'kar do', 'ہاں', 'جی', 'جی ہاں', 'ہاں جی', 'ٹھیک ہے', 'کنفرم', 'اوکے']);
const isYes = text => {
  const t = String(text).toLowerCase().replace(/[.!,،۔?؟*_~]+/g, ' ').replace(/\s+/g, ' ').trim();
  return YES.has(t) || /^(👍|✅|👌)+$/u.test(t.replace(/\s|\p{Emoji_Modifier}/gu, ''));
};
const MEDIA = ['voice', 'audio', 'image', 'video', 'document', 'sticker'];
const scriptLang = text => /[؀-ۿ]/.test(text) ? 'ur' : 'roman_ur';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// "12:00"–"02:00" style hours; closing after midnight is fine. null = always open
function withinHours(hours, d = new Date()) {
  if (!hours?.open || !hours?.close) return true;
  const mins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  const now = d.getHours() * 60 + d.getMinutes(), open = mins(hours.open), close = mins(hours.close);
  return open <= close ? now >= open && now < close : now >= open || now < close;
}

// stt (optional): speech-to-text for voice notes ({ transcribe(file) }); sttCfg: config.stt
function createAssistant({ store, wa, ask, cfg, stt = null, sttCfg = {}, log = console }) {
  const batches = new Map();   // chatId -> { rows, timer }
  const chains = new Map();    // chatId -> promise (one turn at a time per chat)
  let running = 0;
  const waiting = [];
  const slot = async () => { if (running >= cfg.max_parallel_chats) await new Promise(r => waiting.push(r)); running++; };
  const release = () => { running--; waiting.shift()?.(); };

  const enabled = () => (store.meta.get('assistant_enabled') ?? (cfg.enabled_by_default ? '1' : '0')) === '1';
  const setEnabled = on => store.meta.set('assistant_enabled', on ? '1' : '0');
  const minutesAgo = m => new Date(Date.now() - m * 60_000).toISOString();
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

  // Why the assistant should stay quiet for this chat right now (null = go ahead)
  function quietReason(chatId) {
    if (!enabled()) return 'switched off';
    if (!withinHours(cfg.business_hours)) return 'outside business hours';
    const chat = store.chat(chatId);
    if (chat?.bot_paused) return 'paused for this chat';
    if (store.botRepliesSince(chatId, minutesAgo(5)) >= cfg.max_bot_replies_per_chat_per_5_min) return 'too many replies in 5 min (loop guard)';
    if (store.spentSince(startOfDay()) >= cfg.daily_cost_cap_usd) return 'daily cost cap reached';
    if (!wa.isConnected()) return 'WhatsApp disconnected';
    return null;
  }

  async function reply(chatId, text, startedAt) {
    const wait = cfg.min_reply_delay_ms + Math.random() * 1000 - (Date.now() - startedAt); // look human: never instant
    if (wait > 0) await sleep(wait);
    wa.typing(chatId, false);
    return wa.send(chatId, text, 'Assistant', 'bot');
  }

  // Voice notes -> text (Groq Whisper). Done even when the assistant stays quiet, so staff always see what was said.
  // Returns the rows with their transcripts filled in.
  async function transcribeVoice(chatId, rows, willReply) {
    const voice = rows.filter(r => ['voice', 'audio'].includes(r.kind) && r.meta?.file && r.meta.transcript == null);
    if (!voice.length || !stt || !sttCfg.enabled) return rows;
    let acked = false;
    const ack = willReply && setTimeout(() => { acked = true; wa.send(chatId, pick('voice_ack', typedLang(chatId, rows[0].id)), 'Assistant', 'bot').catch(() => {}); }, sttCfg.ack_after_ms);
    try {
      for (const r of voice) {
        if ((r.meta.seconds || 0) > sttCfg.max_seconds) { store.updateMeta(r.id, { transcript: '', stt_error: `longer than ${sttCfg.max_seconds} s` }); continue; }
        if (willReply) wa.typing(chatId, true);
        try {
          const t = await stt.transcribe(wa.mediaPath(r.meta.file));
          // Then read the WHOLE transcript with the menu and write what the customer most likely said
          const c = t.text && sttCfg.cleanup ? await cleanupTranscript(t.text) : null;
          store.updateMeta(r.id, { transcript: t.text, stt_ms: t.ms, stt_logprob: t.avg_logprob, stt_model: sttCfg.model,
            understood: c?.text ?? null, understood_confidence: c?.confidence ?? null, cleanup_ms: c?.ms ?? null },
          t.text ? `🎤 ${c?.text || t.text}` : '🎤 (voice note: no speech heard)');
        } catch (e) { store.updateMeta(r.id, { transcript: '', stt_error: e.message }); log.error?.('Voice note:', e.message); }
      }
    } finally { clearTimeout(ack); }
    return rows.map(r => store.message(r.id) || r).map(r => ({ ...r, acked }));
  }
  // The customer's own script, judged from what they TYPED (voice-note transcripts are always Urdu script)
  const typedLang = (chatId, beforeId) => scriptLang(store.historyBefore(chatId, beforeId, 12)
    .filter(h => h.from === 'customer' && !h.text.startsWith('🎤')).map(h => h.text).join(' ') || 'roman');

  // What the assistant reads: transcripts are marked so it knows they may contain recognition errors
  const turnText = rows => rows.map(r => !(['voice', 'audio'].includes(r.kind) && r.meta?.transcript) ? r.text
    : r.meta.understood
      ? `[Voice note, transcribed automatically — may contain recognition errors] ${r.meta.understood} (raw transcript: ${r.meta.transcript}; clarity: ${r.meta.understood_confidence})`
      : `[Voice note, transcribed automatically — may contain recognition errors] ${r.meta.transcript}`).join('\n');

  async function turn(chatId, rows) {
    rows = rows.map(r => store.message(r.id) || r);
    const reason = quietReason(chatId);
    rows = await transcribeVoice(chatId, rows, !reason);
    const text = turnText(rows);
    const base = { at: new Date().toISOString(), chat_id: chatId, in_text: text.slice(0, 2000) };
    if (reason) return store.log({ ...base, action: `quiet: ${reason}` });

    await slot();
    const t0 = Date.now();
    try {
      wa.typing(chatId, true);
      // Only photos / stickers / voice notes it couldn't get or understand: say which and ask for text
      if (rows.every(r => MEDIA.includes(r.kind) && !r.meta?.transcript && !r.text.includes('\n'))) {
        const isVoice = r => ['voice', 'audio'].includes(r.kind);
        const key = rows.some(r => isVoice(r) && !r.meta?.file) ? 'voice_failed' : rows.some(isVoice) ? 'voice_unclear' : 'media';
        await reply(chatId, pick(key, typedLang(chatId, rows[0].id)), t0);
        return store.log({ ...base, action: `media: ${key.replace('_', ' ')}, asked to resend/type`, ms_total: Date.now() - t0 });
      }
      // "YES" to an order summary: handled by code
      const draft = isYes(text) && store.openDraft(chatId, minutesAgo(cfg.order_confirm_window_minutes));
      if (draft) {
        store.confirmDraft(draft.id);
        await reply(chatId, pick('confirmed', draft.lang), t0);
        return store.log({ ...base, action: `order ${draft.id} confirmed by customer`, order_json: JSON.stringify(draft.items), ms_total: Date.now() - t0 });
      }

      const since = minutesAgo(cfg.order_confirm_window_minutes);
      const location = store.latestLocation(chatId, since);
      const res = await ask({ message: text, history: store.historyBefore(chatId, rows[0].id), location, cart: store.openCart(chatId, since) });
      // The cart is kept by code; only a complete order (delivery/takeaway known; for delivery a real address or pin)
      // can be confirmed with YES
      if (res.cancelled) store.cancelCart(chatId);
      else if (res.order_ok) store.saveDraft(chatId, res.order, res.lang, res.order_complete ? 'awaiting_customer' : 'building');
      await reply(chatId, res.reply, t0);
      store.log({
        ...base, action: res.error ? 'fallback (LLM error)' : res.guard?.invented?.length ? 'fallback (invented amount blocked)' : 'replied',
        reply: res.reply, intent: res.intent, lang: res.lang, handoff: res.handoff ? 1 : 0,
        order_json: res.order_ok ? JSON.stringify(res.order.lines) : null, invented: res.guard?.invented?.length ? res.guard.invented.join(',') : null,
        knowledge_version: res.knowledge_version, prompt_version: res.prompt_version, ms_total: Date.now() - t0, ms_llm: res.ms?.llm,
        prompt_tokens: res.usage?.prompt_tokens, cached_tokens: res.usage?.prompt_cache_hit_tokens, output_tokens: res.usage?.completion_tokens,
        cost_usd: res.cost_usd, error: res.error,
      });
    } catch (e) {
      wa.typing(chatId, false);
      store.log({ ...base, action: 'error', error: e.message, ms_total: Date.now() - t0 });
      log.error?.('WhatsApp assistant:', e.message);
    } finally { release(); }
  }

  // Called for every new live customer message
  function onIncoming(row) {
    const b = batches.get(row.chat_id) || { rows: [] };
    clearTimeout(b.timer);
    b.rows.push(row);
    b.timer = setTimeout(() => {
      batches.delete(row.chat_id);
      const prev = chains.get(row.chat_id) || Promise.resolve();
      const next = prev.then(() => turn(row.chat_id, b.rows));
      chains.set(row.chat_id, next);
      next.finally(() => { if (chains.get(row.chat_id) === next) chains.delete(row.chat_id); });
    }, cfg.merge_wait_ms);
    batches.set(row.chat_id, b);
  }

  // Resolves when every queued turn has finished (used by tests)
  const idle = async () => { while (batches.size || chains.size) await sleep(50); };

  return { onIncoming, enabled, setEnabled, quietReason, idle, isYes, withinHours };
}

module.exports = { createAssistant, isYes, withinHours };
