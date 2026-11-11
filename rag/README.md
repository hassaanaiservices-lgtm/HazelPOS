# rag/ — the WhatsApp assistant's knowledge and answers

See [PLAN.md](PLAN.md) for decisions, risks and phases. Every folder has one job:

| Folder | Job | Phase |
|---|---|---|
| `data/raw/` | Menu, categories, delivery areas, promos exported from the POS; `faq/` text files written by the owner | 2 |
| `data/processed/` | `chunks.jsonl` — chunking output, readable by a person | 3 |
| `data/index/` | Vector store files (generated, not committed) | 4 |
| `config/rag.config.json` | Every setting: models, chunking, top-k, cut-offs, hours, limits | 0 |
| `prompts/` | Every instruction the LLM receives, as plain text files | 6 |
| `src/loaders/` | Read raw data into clean documents (one per product, one per FAQ) | 2 |
| `src/chunking/` | Documents into chunks | 3 |
| `src/embedding/` | Embedding model — not used for now (menu goes in the prompt) | — |
| `src/vectorstore/` | Vector store — not used for now | — |
| `src/indexing/` | Not used for now | — |
| `src/retrieval/` | Not used for now | — |
| `src/context/` | **Live knowledge**: restaurant, FAQ, delivery areas, menu by category, read from `pos.db` at every message | 4 |
| `src/generation/` | Prompt + DeepSeek call + answer | 6 |
| `src/pipeline/` | `ask(question, chat)` = rewrite + retrieve + live data + generate | 6 |
| `eval/datasets/` | Test questions with the right answers | 5–6 |
| `eval/reports/` | Saved results of every test run, for comparison | 5–7 |
| `scripts/` | Command-line checks: DeepSeek connection, inspect chunks, inspect a search, run tests | 0+ |

The WhatsApp connection itself (QR linking, messages, the cashier chat window) is not part of the RAG: it lives in
`server/whatsapp/` and `client/src/WhatsApp.jsx`.

## Checks you can run now

```bash
node rag/scripts/check-deepseek.js     # is the DeepSeek key in .env working? how fast is a reply?
node rag/scripts/export-pos.js         # copy menu, categories, delivery areas, restaurant info from the POS to data/raw/
node rag/scripts/validate-data.js      # export + load + check; report in eval/reports/data-validation.md
node rag/scripts/build-chunks.js       # export + load + chunk + check; every chunk in eval/reports/chunks.md
node rag/scripts/inspect-chunks.js     # list chunks; add an ID (product:4) to see one, or --find zinger
node rag/scripts/show-context.js       # the exact live knowledge the assistant reads; --diff = what changed
node rag/scripts/check-testset.js      # check the test set against the live menu; review sheet in eval/reports/testset-review.md
node rag/scripts/run-eval.js           # ask DeepSeek every test question, score it; report in eval/reports/latest.md (--only order-)
```

Test set: `eval/datasets/questions.jsonl` (format in `eval/datasets/SCHEMA.md`).

FAQ answers (hours, payment, halal…) are written by the owner in `data/raw/faq/` — see `data/raw/faq/_example.md`.

## The assistant on WhatsApp (phase 7)

Code: `server/whatsapp/assistant.js` (when to reply), `server/whatsapp/messages.js` (fixed texts), `server/whatsapp/index.js`
(routes; accepting an order uses the POS's own `createOrder` in `server/index.js`). Settings: `assistant` in
`config/rag.config.json` (business hours, reply delay, staff takeover time, loop guard, daily cost cap).

Flow: customer messages → quick messages merged (2.5 s) → assistant replies with "typing…" (≥ 1.5 s) → order summary
(total by code) → customer writes YES (handled by code) → cashier sees 🧾 order card → **Accept…** (delivery/takeaway,
address, area) → real POS order, kitchen ticket, customer gets the final bill on WhatsApp.

The assistant goes quiet only when told: switched off (🤖 button) or paused for that chat (⏸) — plus outside business
hours and two safety limits (8 bot replies in 5 min in one chat; daily cost cap). Staff messages never silence it.
Whenever it stays quiet, the chat is marked "needs you"; a staff reply (or Done) clears it.
Messages that arrived while the POS was offline are never auto-answered. Each decision is in the chat's 📋 log.

## Voice notes (speech-to-text, Groq Whisper)

Engine: Whisper large-v3 hosted by Groq, so every PC gets the same speed (about 1 s for a 30 s note) with nothing to install.
Code: `server/whatsapp/stt.js`. Settings: `stt` in `config/rag.config.json`.

Setup: create a key at https://console.groq.com and add it to `.env` at the project root:
```
GROQ_API_KEY=gsk_...
```
Cost: about $0.11 per hour of audio, billed with a 10 s minimum per note. The audio is sent to Groq.

After transcription, DeepSeek rewrites the transcript against the menu (`cleanup` in the config).
Staff ratings and corrections (👍 / ✎ on a voice note) are saved in the `stt_feedback` table as a test set.
Recording sheet for real test voice notes: `eval/datasets/voice-script.md`.
