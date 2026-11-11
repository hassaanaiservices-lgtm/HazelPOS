// Phase 0 check: is the DeepSeek key in .env working, and how fast is a reply?
// Run from the project root:  node rag/scripts/check-deepseek.js
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const envFile = path.join(root, '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'rag.config.json'), 'utf8')).llm

const key = process.env.DEEPSEEK_API_KEY
if (!key) {
  console.error('DEEPSEEK_API_KEY is empty. Put it in .env at the project root:  DEEPSEEK_API_KEY=sk-...')
  process.exit(1)
}

async function ask(question) {
  const t0 = Date.now()
  const r = await fetch(cfg.base_url + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      thinking: { type: cfg.thinking },
      max_tokens: 60,
      messages: [
        { role: 'system', content: 'You are a restaurant assistant. Reply in one short sentence, in the language of the question.' },
        { role: 'user', content: question },
      ],
    }),
    signal: AbortSignal.timeout(cfg.timeout_ms),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.error?.message || JSON.stringify(body)}`)
  return { ms: Date.now() - t0, text: body.choices?.[0]?.message?.content?.trim(), usage: body.usage, model: body.model }
}

;(async () => {
  console.log(`Model ${cfg.model}, thinking ${cfg.thinking}, ${cfg.base_url}\n`)
  const questions = ['Do you deliver to DHA?', 'pizza kitne ki hai?', 'کیا آپ کے پاس برگر ہے؟']
  const times = []
  for (const q of questions) {
    try {
      const a = await ask(q)
      times.push(a.ms)
      console.log(`Q: ${q}\nA: ${a.text}\n   ${a.ms} ms, ${a.usage?.prompt_tokens} in / ${a.usage?.completion_tokens} out tokens (${a.model})\n`)
    } catch (e) {
      console.error(`FAILED on "${q}": ${e.message}`)
      process.exit(1)
    }
  }
  console.log(`OK: key works. Fastest ${Math.min(...times)} ms, slowest ${Math.max(...times)} ms.`)
})()
