// Documents -> chunks (the pieces that get embedded and searched).
//
//   id       "product:4" for a one-piece document; "faq:general#timings~2" for the 2nd piece of a split one
//   doc_id   the document it came from (answers use it to read live data, e.g. the product's price)
//   text     exactly what is embedded and shown to the LLM
//   hash     changes when text or availability changes; phase 4 re-embeds only chunks whose hash changed
const crypto = require('crypto');
const { splitText } = require('./split-text');

const hashOf = (text, active) => crypto.createHash('sha256').update(`${active ? 1 : 0}\n${text}`).digest('hex').slice(0, 16);

function chunkDocument(doc, cfg) {
  const whole = cfg.whole_document_types.includes(doc.type);
  let pieces = [doc.text];
  if (!whole && doc.text.length > cfg.max_chars) {
    // Split only the answer; every piece starts with the question so it still makes sense on its own
    const head = doc.type === 'faq' ? doc.data.question : doc.title;
    const body = doc.type === 'faq' ? doc.data.answer : doc.text;
    pieces = splitText(body, { maxChars: cfg.max_chars - head.length - 1, overlapChars: cfg.overlap_chars }).map(p => `${head}\n${p}`);
  }
  return pieces.map((text, i) => ({
    id: pieces.length > 1 ? `${doc.id}~${i + 1}` : doc.id,
    doc_id: doc.id, type: doc.type, title: doc.title, part: i + 1, parts: pieces.length,
    text, active: doc.active, hash: hashOf(text, doc.active),
  }));
}

const chunkDocuments = (documents, cfg) => documents.flatMap(d => chunkDocument(d, cfg));

module.exports = { chunkDocuments, chunkDocument };
