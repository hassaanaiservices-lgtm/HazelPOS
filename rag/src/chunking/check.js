// Phase 3 "done when" checks on the chunks. Returns a list of failures (empty = pass) plus stats.
function checkChunks(documents, chunks, cfg) {
  const fail = [];
  const ids = new Set();
  for (const c of chunks) {
    if (ids.has(c.id)) fail.push(`duplicate chunk ID ${c.id}`);
    ids.add(c.id);
    if (!c.text.trim()) fail.push(`${c.id} is empty`);
    if (c.text.length > cfg.max_chars && !cfg.whole_document_types.includes(c.type)) fail.push(`${c.id} is ${c.text.length} chars (max ${cfg.max_chars})`);
  }
  for (const d of documents) {
    const mine = chunks.filter(c => c.doc_id === d.id);
    if (!mine.length) fail.push(`${d.id} produced no chunk`);
    if (cfg.whole_document_types.includes(d.type) && mine.length !== 1) fail.push(`${d.id} must be exactly 1 chunk, got ${mine.length}`);
    if (cfg.whole_document_types.includes(d.type) && mine[0] && mine[0].text !== d.text) fail.push(`${d.id} chunk text differs from the document`);
    // Every word of the document must survive chunking (nothing dropped at a cut)
    const all = mine.map(c => c.text).join(' ');
    const lost = [...new Set(d.text.split(/\s+/))].filter(w => w && !all.includes(w));
    if (lost.length) fail.push(`${d.id} lost words when split: ${lost.slice(0, 5).join(' ')}`);
  }
  for (const d of documents.filter(d => d.type === 'product')) {
    const c = chunks.find(c => c.doc_id === d.id);
    if (c && !c.text.includes(d.title)) fail.push(`${c.id} doesn't contain the product name`);
  }

  const lens = chunks.map(c => c.text.length).sort((a, b) => a - b);
  const byType = chunks.reduce((a, c) => ({ ...a, [c.type]: (a[c.type] || 0) + 1 }), {});
  const stats = { chunks: chunks.length, documents: documents.length, byType,
    chars: { min: lens[0] || 0, median: lens[Math.floor(lens.length / 2)] || 0, max: lens.at(-1) || 0 },
    split_documents: new Set(chunks.filter(c => c.parts > 1).map(c => c.doc_id)).size };
  return { fail, stats };
}

module.exports = { checkChunks };
