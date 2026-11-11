// rag/data/raw/faq/*.md, written by the owner -> one document per question.
// Format: each "## " heading is a question (or topic); the text under it is the answer.
// Files starting with "_" (like _example.md) are ignored.
const fs = require('fs');
const path = require('path');
const { makeDocument } = require('./document');

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);

function loadFaq(faqDir) {
  const documents = [], problems = [];
  if (!fs.existsSync(faqDir)) return { documents, problems, files: [] };
  const files = fs.readdirSync(faqDir).filter(f => f.endsWith('.md') && !f.startsWith('_')).sort();
  for (const file of files) {
    const text = fs.readFileSync(path.join(faqDir, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const sections = text.split(/^## +/m).slice(1); // text before the first "## " is a file comment
    if (!sections.length) problems.push({ level: 'error', where: `faq/${file}`, msg: 'No "## Question" headings found' });
    const seen = new Set();
    for (const s of sections) {
      const [heading, ...body] = s.split('\n');
      const answer = body.join('\n').trim();
      let id = `faq:${file.replace(/\.md$/, '')}#${slug(heading)}`;
      while (seen.has(id)) id += '-2';
      seen.add(id);
      documents.push(makeDocument({ id, type: 'faq', title: heading, text: `${heading.trim()}\n${answer}`, source: `faq/${file}`, data: { question: heading.trim(), answer } }));
    }
  }
  return { documents, problems, files };
}

module.exports = { loadFaq };
