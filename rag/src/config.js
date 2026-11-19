// One place that reads rag/config/rag.config.json and knows where every folder is.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'rag.config.json'), 'utf8'));
// DEEPSEEK_BASE_URL: tests point the assistant at a fake DeepSeek (same variable as cloud/index.js)
if (process.env.DEEPSEEK_BASE_URL) config.llm.base_url = process.env.DEEPSEEK_BASE_URL.replace(/\/+$/, '');

const paths = {
  root: ROOT,
  raw: path.join(ROOT, 'data', 'raw'),
  faq: path.join(ROOT, 'data', 'raw', 'faq'),
  processed: path.join(ROOT, 'data', 'processed'),
  index: path.join(ROOT, 'data', 'index'),
  reports: path.join(ROOT, 'eval', 'reports'),
  prompts: path.join(ROOT, 'prompts'),
  // POS_DB lets tests point at a copy of the database
  posDb: process.env.POS_DB || path.resolve(ROOT, config.data.pos_db),
};

module.exports = { config, paths };
