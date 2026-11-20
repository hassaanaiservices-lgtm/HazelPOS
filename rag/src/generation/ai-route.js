// Where the AI calls go. With DEEPSEEK_API_KEY / GROQ_API_KEY in .env (your own PC) they go straight to DeepSeek and
// Groq. Without them (the installed app at a restaurant) they go through HazelPOS Cloud with this branch's key, so the
// AI keys stay on your server and each restaurant's usage is counted there.
// setCloudLink() is kept for the old installed app; nothing calls it in the online version.
let link = { url: '', key: '' };

const setCloudLink = (url, key) => { link = { url: String(url || '').replace(/\/+$/, ''), key: String(key || '') }; };
const cloudLink = () => (link.url && link.key ? link : null);

// POST to the cloud's AI proxy. Returns the provider's own response body, like a direct call would.
async function viaCloud(urlPath, { body, headers = {}, signal }) {
  const c = cloudLink();
  if (!c) throw new Error('No AI key on this PC and HazelPOS Cloud is not connected (Settings → Cloud)');
  const r = await fetch(c.url + urlPath, { method: 'POST', body, headers: { ...headers, Authorization: 'Bearer ' + c.key }, signal });
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

module.exports = { setCloudLink, cloudLink, viaCloud };
