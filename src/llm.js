// Couche moteur IA : Claude (Anthropic, avec recherche web native) ou moteur compatible OpenAI / Ollama (local).
const store = require('./store');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function cfg() { return store.settings.get().ai; }

function isLocal(ai = cfg()) {
  if (ai.provider === 'ollama') return true;
  if (ai.provider === 'openai') {
    try { const h = new URL(ai.baseUrl).hostname; return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h); } catch { return false; }
  }
  return false;
}

function isOpenAICloud(ai = cfg()) {
  try { return ai.provider === 'openai' && new URL(ai.baseUrl).hostname === 'api.openai.com'; } catch { return false; }
}

function configured() {
  const ai = cfg();
  if (ai.provider === 'anthropic') return store.hasSecret('anthropic_key');
  if (ai.provider === 'ollama') return !!ai.localModel;
  if (isOpenAICloud(ai)) return store.hasSecret('openai_key') && !!ai.localModel;
  return !!ai.baseUrl && !!ai.localModel;
}

function parseJson(text) {
  if (!text) return null;
  const t = text.replace(/```json|```/g, '');
  const m = t.match(/[\[{][\s\S]*[\]}]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function httpJson(url, opts, label) {
  let res;
  try { res = await fetch(url, opts); }
  catch (e) { throw new Error(`${label} injoignable (${e.cause?.code || e.message}). Vérifie ta connexion ou l'adresse du moteur.`); }
  const body = await res.text();
  let json = null; try { json = JSON.parse(body); } catch { /* texte brut */ }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error || body.slice(0, 300);
    if (res.status === 401) throw new Error(`${label} : clé API refusée (401). Vérifie la clé dans Réglages.`);
    if (res.status === 429) throw new Error(`${label} : limite de débit atteinte (429). Réessaie dans un instant.`);
    throw new Error(`${label} (${res.status}) : ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return json;
}

async function anthropic({ system, messages, web, fast, maxTokens }) {
  const ai = cfg();
  const key = store.getSecret('anthropic_key');
  if (!key) throw new Error("Aucune clé Claude enregistrée. Ouvre Réglages › Moteur IA.");
  const model = fast ? (ai.fastModel || ai.model) : ai.model;
  const tools = web ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }] : undefined;
  let msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  let text = ''; const sources = new Map();
  for (let turn = 0; turn < 5; turn++) {
    const json = await httpJson(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: msgs, ...(tools ? { tools } : {}) }),
    }, 'Claude');
    for (const b of json.content || []) {
      if (b.type === 'text') {
        text += b.text;
        for (const c of b.citations || []) if (c.url) sources.set(c.url, c.title || c.url);
      } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url) sources.set(r.url, r.title || r.url);
      }
    }
    if (json.stop_reason === 'pause_turn') { msgs = [...msgs, { role: 'assistant', content: json.content }]; continue; }
    break;
  }
  return { text: text.trim(), sources: [...sources].map(([url, title]) => ({ url, title })), model };
}

async function openaiLike({ system, messages, fast, maxTokens }) {
  const ai = cfg();
  const base = (ai.provider === 'ollama' ? (ai.baseUrl || 'http://localhost:11434/v1') : ai.baseUrl).replace(/\/$/, '');
  const cloud = isOpenAICloud(ai);
  const key = store.getSecret(cloud ? 'openai_key' : 'compat_key'); // la clé OpenAI ne part jamais vers un autre serveur
  const model = (fast && ai.fastLocalModel) ? ai.fastLocalModel : ai.localModel;
  if (!model) throw new Error('Aucun modèle choisi. Ouvre Réglages › Moteur IA.');
  if (cloud && !key) throw new Error("Aucune clé OpenAI enregistrée. Ouvre Réglages › Moteur IA.");
  const json = await httpJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, ...(cloud ? { max_completion_tokens: Math.max(maxTokens || 1000, 1000) } : { max_tokens: maxTokens }), messages: [{ role: 'system', content: system || '' }, ...messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))] }),
  }, cloud ? 'OpenAI' : 'Moteur local');
  return { text: (json.choices?.[0]?.message?.content || '').trim(), sources: [], model };
}

// Recherche web de secours pour les moteurs sans outil web (DuckDuckGo HTML).
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}
async function fallbackWebContext(query) {
  const ctl = (ms) => AbortSignal.timeout(ms);
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { headers: { 'user-agent': 'Mozilla/5.0 JarvisParlement' }, signal: ctl(12000) });
  const html = await r.text();
  const links = [];
  for (const m of html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    let u = m[1]; const q = u.match(/uddg=([^&]+)/); if (q) u = decodeURIComponent(q[1]);
    if (/^https?:/.test(u)) links.push({ url: u, title: htmlToText(m[2]) });
    if (links.length >= 4) break;
  }
  const pages = await Promise.all(links.map(async (l) => {
    try { const p = await fetch(l.url, { headers: { 'user-agent': 'Mozilla/5.0 JarvisParlement' }, signal: ctl(10000) }); return { ...l, text: htmlToText(await p.text()).slice(0, 6000) }; }
    catch { return { ...l, text: '' }; }
  }));
  return pages;
}

/**
 * complete({ system, messages|prompt, web, fast, maxTokens, json })
 * -> { text, sources, model, data? }
 */
async function complete(o) {
  const ai = cfg();
  const messages = o.messages || [{ role: 'user', content: o.prompt }];
  const maxTokens = o.maxTokens || 4096;
  let out;
  if (ai.provider === 'anthropic') {
    out = await anthropic({ system: o.system, messages, web: o.web && ai.webSearch, fast: o.fast, maxTokens });
  } else {
    let sys = o.system; let sources = [];
    if (o.web && ai.webSearch) {
      try {
        const last = messages[messages.length - 1];
        const pages = await fallbackWebContext(String(last.content).slice(0, 200));
        sources = pages.map(({ url, title }) => ({ url, title }));
        sys += '\n\nRÉSULTATS WEB (extraits, à citer avec leur URL) :\n' + pages.map((p, i) => `[${i + 1}] ${p.title} — ${p.url}\n${p.text}`).join('\n\n');
      } catch { sys += '\n\n(La recherche web a échoué : signale-le dans ta réponse.)'; }
    }
    out = await openaiLike({ system: sys, messages, fast: o.fast, maxTokens });
    out.sources = sources;
  }
  if (o.json) out.data = parseJson(out.text);
  return out;
}

async function ping() {
  const t0 = Date.now();
  const r = await complete({ system: 'Réponds uniquement par OK.', prompt: 'ping', fast: true, maxTokens: 16 });
  return { ms: Date.now() - t0, model: r.model, reply: r.text.slice(0, 20) };
}

async function listLocalModels() {
  const ai = cfg();
  const base = (ai.baseUrl || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
  try {
    const r = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  } catch { return []; }
}

// Liste des modèles disponibles selon le fournisseur choisi (clé / adresse éventuellement saisies mais pas encore enregistrées).
async function listModels({ provider, baseUrl, key } = {}) {
  const ai = cfg(); const prov = provider || ai.provider;
  try {
    if (prov === 'anthropic') {
      const k = key || store.getSecret('anthropic_key');
      if (!k) return { models: [], error: 'Entre ta clé API pour voir les modèles disponibles.' };
      const j = await httpJson(ANTHROPIC_URL.replace(/\/messages$/, '/models?limit=100'), { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(8000) }, 'Claude');
      return { models: (j.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id })) };
    }
    const base = (baseUrl || ai.baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '');
    if (prov === 'ollama') {
      const r = await fetch(base.replace(/\/v1$/, '') + '/api/tags', { signal: AbortSignal.timeout(4000) }); const j = await r.json();
      const ms = (j.models || []).map((m) => ({ id: m.name, label: m.name }));
      return ms.length ? { models: ms } : { models: [], error: "Ollama répond mais aucun modèle n'est installé : lance « ollama pull mistral »." };
    }
    const k = key || store.getSecret(/^https:\/\/api\.openai\.com/.test(base) ? 'openai_key' : 'compat_key');
    if (!k && /^https:\/\/api\.openai\.com/.test(base)) return { models: [], error: 'Entre ta clé API OpenAI pour voir les modèles disponibles.' };
    const j = await httpJson(base + '/models', { headers: k ? { authorization: 'Bearer ' + k } : {}, signal: AbortSignal.timeout(8000) }, 'Serveur');
    let ms = (j.data || j.models || []).map((m) => ({ id: m.id || m.name, label: m.id || m.name })).filter((m) => m.id);
    if (/^https:\/\/api\.openai\.com/.test(base)) ms = ms.filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(embedding|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|instruct|codex|vision-preview|\d{4}-\d{2}-\d{2}$)/.test(m.id)).sort((a, b) => b.id.localeCompare(a.id));
    return { models: ms };
  } catch (e) { return { models: [], error: prov === 'ollama' ? "Ollama ne répond pas : est-il lancé ? (ollama.com)" : e.message }; }
}

module.exports = { isOpenAICloud, complete, ping, isLocal, configured, parseJson, listLocalModels, listModels };
