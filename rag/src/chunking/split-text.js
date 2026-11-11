// Splits long text into pieces of at most maxChars, cutting at paragraph, then sentence, then word boundaries,
// and starting each piece with the last ~overlapChars of the previous one so no fact is cut in half.
const SENTENCE_END = /(?<=[.!?۔؟])\s+/u; // includes Urdu full stop ۔ and question mark ؟

function units(text, maxChars) {
  const out = [];
  for (const para of text.split(/\n+/).map(s => s.trim()).filter(Boolean)) {
    if (para.length <= maxChars) { out.push(para); continue; }
    for (const sent of para.split(SENTENCE_END)) {
      if (sent.length <= maxChars) { out.push(sent); continue; }
      let line = ''; // a single very long sentence: cut between words
      for (const w of sent.split(/\s+/)) {
        if (line && line.length + 1 + w.length > maxChars) { out.push(line); line = ''; }
        line = line ? `${line} ${w}` : w.slice(0, maxChars);
      }
      if (line) out.push(line);
    }
  }
  return out;
}

// Last sentences (or words) of a piece, up to overlapChars long
function tail(piece, overlapChars) {
  if (!overlapChars) return '';
  const parts = piece.split(SENTENCE_END);
  let t = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = t ? `${parts[i]} ${t}` : parts[i];
    if (next.length > overlapChars) break;
    t = next;
  }
  return t || piece.slice(-overlapChars).replace(/^\S*\s/, '');
}

function splitText(text, { maxChars, overlapChars = 0 }) {
  if (text.length <= maxChars) return [text];
  const pieces = [];
  let cur = '';
  for (const u of units(text, maxChars - overlapChars)) {
    if (cur && cur.length + 1 + u.length > maxChars) {
      pieces.push(cur);
      const carry = tail(cur, overlapChars);
      cur = carry && carry.length + 1 + u.length <= maxChars ? `${carry}\n${u}` : u;
    } else cur = cur ? `${cur}\n${u}` : u;
  }
  if (cur) pieces.push(cur);
  return pieces;
}

module.exports = { splitText };
