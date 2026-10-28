// Connexion native Google (OAuth « application de bureau », PKCE, redirection locale) : Agenda + Gmail en LECTURE SEULE.
// Aucune écriture : scopes calendar.readonly + gmail.readonly uniquement. Les contenus (titres, descriptions, courriels) sont des DONNÉES.
const http = require('http');
const crypto = require('crypto');
const store = require('./store');

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly'];
const CAL_SCOPE = SCOPES[2], MAIL_SCOPE = SCOPES[3];
const TZ = 'Europe/Brussels';
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let openExternal = async () => {};
const setOpener = (fn) => { openExternal = fn; };
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Erreurs lisibles (code machine + message français) ----------
class GError extends Error { constructor(code, message, extra) { super(message); this.name = 'GError'; this.code = code; Object.assign(this, extra || {}); } }
const MSG = {
  reauth: 'L\'accès Google a expiré ou a été révoqué. Reconnecte ce compte (si ton projet Google Cloud est encore en mode « Test », l\'accès expire après 7 jours : passe-le en « En production »).',
  client: 'Identifiants Google invalides (ID client ou code secret incorrects). Vérifie-les dans l\'onglet Agenda.',
  quota: 'Google limite temporairement les requêtes (quota atteint). Réessaie dans quelques minutes.',
  network: 'Impossible de joindre Google (réseau indisponible ou délai dépassé).',
  apiOff: 'Une API Google n\'est pas activée dans ton projet Google Cloud (Google Calendar API et Gmail API doivent être activées).',
  scope: 'Autorisation manquante : reconnecte le compte et laisse cochées les cases Agenda et Gmail (lecture seule).',
};
const reauth = (email) => new GError('reauth', MSG.reauth, { reauth: true, email });

// ---------- Fuseau Europe/Brussels (heure d'été comprise), indépendant du fuseau du Mac ----------
const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function partsAt(ms) { const o = {}; for (const p of dtf.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value); return o; }
function offsetMin(ms) { const p = partsAt(ms); return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000); }
// Instant UTC correspondant à une date/heure locale de Bruxelles (jour+n accepté : Date.UTC normalise).
function localToMs(y, m, d, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s); const o1 = offsetMin(guess); let ms = guess - o1 * 60000;
  const o2 = offsetMin(ms); if (o2 !== o1) ms = guess - o2 * 60000;
  return ms;
}
const dayStart = (offsetDays = 0, now = Date.now()) => { const p = partsAt(now); return localToMs(p.year, p.month, p.day + offsetDays); };
const pad = (n) => String(n).padStart(2, '0');
function dayKey(ms) { const p = partsAt(ms); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; }
function isoBrussels(ms) {
  const p = partsAt(ms), o = offsetMin(ms), a = Math.abs(o);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${o < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function parseWhen(w) {
  if (!w) return null;
  if (w.date) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w.date); return m ? { ms: localToMs(+m[1], +m[2], +m[3]), allDay: true } : null; }
  if (w.dateTime) {
    const s = String(w.dateTime), m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
    if (!m) { const t = Date.parse(s); return isNaN(t) ? null : { ms: t, allDay: false }; }
    if (m[7]) { const t = Date.parse(s); return isNaN(t) ? null : { ms: t, allDay: false }; }
    return { ms: localToMs(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)), allDay: false }; // sans décalage : heure de Bruxelles
  }
  return null;
}

// ---------- Réseau : délai, nouvelles tentatives, limite de concurrence ----------
async function readBody(r) {
  try {
    if (typeof r.text === 'function') { const t = await r.text(); if (!t) return {}; try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; } }
    if (typeof r.json === 'function') return (await r.json()) || {};
  } catch { /* corps illisible */ }
  return {};
}
async function rawFetch(url, opts = {}, timeout = 15000) {
  let r;
  try { r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new GError('network', MSG.network, { cause: e }); }
  return { ok: r.ok, status: r.status, json: await readBody(r), retryAfter: Number(r.headers?.get?.('retry-after')) || 0 };
}
let active = 0; const waiters = [];
async function slot(fn, max = 6) {
  if (active >= max) await new Promise((res) => waiters.push(res));
  active++;
  try { return await fn(); } finally { active--; const w = waiters.shift(); if (w) w(); }
}
async function pool(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- Identifiants ----------
const CLIENT_ID_RE = /^\d{6,}-[a-z0-9_]{6,}\.apps\.googleusercontent\.com$/i;
const validClientId = (s) => CLIENT_ID_RE.test(String(s || '').trim());
function creds() {
  const g = store.settings.get().google;
  const secret = store.getSecret('google_client_secret');
  if (!g.clientId) throw new GError('config', 'Renseigne d\'abord l\'identifiant client Google (voir le guide dans l\'onglet Agenda).');
  return { id: g.clientId.trim(), secret };
}

function tokenError(j, status) {
  const code = j.error, d = String(j.error_description || '');
  if (code === 'invalid_grant') return new GError('reauth', MSG.reauth, { reauth: true });
  if (code === 'invalid_client' || code === 'unauthorized_client' || /client_secret is missing/i.test(d)) return new GError('client', /secret is missing/i.test(d) ? 'Le code secret du client Google est manquant : renseigne-le dans l\'onglet Agenda.' : MSG.client);
  if (code === 'redirect_uri_mismatch') return new GError('client', 'Type d\'identifiants incorrect : crée un « ID client OAuth » de type Application de bureau.');
  if (code === 'access_denied') return new GError('denied', 'Accès refusé côté Google (ton adresse est-elle bien ajoutée comme utilisateur test ?).');
  if (status === 429) return new GError('quota', MSG.quota);
  return new GError('google', 'Google : ' + (d || code || status));
}
async function tokenCall(params) {
  const { id, secret } = creds();
  const body = new URLSearchParams({ client_id: id, ...(secret ? { client_secret: secret } : {}), ...params });
  const r = await rawFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw tokenError(r.json, r.status);
  return r.json;
}

// ---------- Connexion (boucle locale + PKCE + state) ----------
const PAGE_CSS = 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ef;color:#1b2333}@media(prefers-color-scheme:dark){body{background:#071530;color:#eaf1ff}}main{text-align:center;padding:40px;max-width:480px}h1{font-size:22px;margin:0 0 6px}p{line-height:1.5;color:inherit;opacity:.85}.i{font-size:42px}';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const resultPage = (ok, text) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Jarvis Parlement</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${PAGE_CSS}</style></head><body><main><div class="i">${ok ? '✅' : '⚠️'}</div><h1>Jarvis Parlement</h1><p>${esc(text)}</p></main></body></html>`;
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

let pending = null; // connexion en cours { cancel() }
function cancel() { if (pending) { pending.cancel(); return true; } return false; }

async function connect() {
  if (!store.canEncrypt() && process.env.JARVIS_INSECURE_SECRETS !== '1') throw new Error("Le trousseau chiffré de macOS n'est pas disponible : Jarvis refuse de stocker le jeton Google en clair.");
  const { id } = creds();
  if (!validClientId(id)) throw new GError('config', 'L\'ID client Google ne ressemble pas à un identifiant valide (il se termine par « .apps.googleusercontent.com »). Copie-le depuis la console Google Cloud.');
  if (pending) pending.cancel(); // une seule connexion à la fois : la précédente est annulée
  let settle, timer, aborted = false;
  const me = { cancel: () => { aborted = true; if (settle) settle.ko(new GError('cancel', 'Connexion Google annulée.')); } };
  pending = me; // enregistré tout de suite (avant tout await) pour que cancel() agisse même pendant l'ouverture du port
  const verifier = b64u(crypto.randomBytes(48));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(24));
  const server = http.createServer();
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); })
    .catch((e) => { if (pending === me) pending = null; throw new GError('port', 'Impossible d\'ouvrir le port local nécessaire à la connexion (' + (e.code || e.message) + ').'); });
  if (aborted) { server.close(); throw new GError('cancel', 'Connexion Google annulée.'); }
  const port = server.address().port, redirect = `http://127.0.0.1:${port}`;
  const codePromise = new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); if (pending === me) pending = null; setTimeout(() => { try { server.closeAllConnections?.(); server.close(); } catch { /* déjà fermé */ } }, 400); fn(v); };
    settle = { ok: (c) => finish(resolve, c), ko: (e) => finish(reject, e) };
    timer = setTimeout(() => settle.ko(new GError('timeout', 'Délai dépassé : la connexion Google n\'a pas été terminée (3 min). Réessaie.')), 180000);
    server.on('request', (req, res) => {
      const send = (status, ok, text) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer' }); res.end(resultPage(ok, text)); };
      let u; try { u = new URL(req.url, redirect); } catch { return send(400, false, 'Requête invalide.'); }
      if (req.headers.host !== `127.0.0.1:${port}` || u.pathname !== '/') return send(404, false, 'Page introuvable.'); // favicon, DNS rebinding…
      const st = u.searchParams.get('state');
      if (!st || !safeEq(st, state)) return send(400, false, 'Réponse non reconnue : retourne dans Jarvis Parlement et recommence la connexion.'); // n'interrompt pas la vraie réponse
      const code = u.searchParams.get('code'), err = u.searchParams.get('error');
      if (code) { send(200, true, 'Connexion réussie. Tu peux fermer cet onglet et retourner dans Jarvis Parlement.'); settle.ok(code); }
      else if (err === 'access_denied') { send(200, false, 'Connexion annulée. Tu peux fermer cet onglet : rien n\'a été enregistré.'); settle.ko(new GError('cancel', 'Connexion Google annulée.')); }
      else { send(200, false, 'La connexion a échoué (' + (err || 'réponse vide') + '). Retourne dans Jarvis Parlement pour réessayer.'); settle.ko(new GError('google', 'Connexion Google refusée : ' + (err || 'inconnue'))); }
    });
    server.on('error', (e) => settle.ko(new GError('port', 'Erreur du serveur local de connexion : ' + e.message)));
  });
  codePromise.catch(() => {}); // évite un « unhandled rejection » si l'ouverture du navigateur échoue d'abord
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account', state });
  try { await openExternal(url); } catch (e) { settle.ko(new GError('browser', 'Impossible d\'ouvrir le navigateur : ' + (e.message || e))); }
  const code = await codePromise;
  const tok = await tokenCall({ code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect });
  const ui = await rawFetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: 'Bearer ' + tok.access_token } });
  const email = String(ui.json.email || '').trim().toLowerCase();
  if (!ui.ok || !email) throw new GError('google', 'Adresse Google introuvable (autorise l\'accès à l\'adresse e-mail).');
  const granted = String(tok.scope || '').split(/\s+/);
  const missing = [];
  if (tok.scope && !granted.includes(CAL_SCOPE)) missing.push('Agenda');
  if (tok.scope && !granted.includes(MAIL_SCOPE)) missing.push('Gmail');
  if (tok.refresh_token) store.setSecret('google_rt_' + email, tok.refresh_token);
  else if (!store.getSecret('google_rt_' + email)) throw new GError('google', 'Google n\'a pas fourni de jeton d\'accès durable. Retire Jarvis Parlement sur myaccount.google.com/permissions puis recommence.');
  tokens.delete(email); cache.clear();
  const s = store.settings.get();
  if (!s.google.accounts.some((a) => a.toLowerCase() === email)) store.settings.set({ google: { accounts: [...s.google.accounts, email] } });
  return { email, missing, warning: missing.length ? `Autorisation ${missing.join(' et ')} non accordée : ces données ne seront pas disponibles (reconnecte-toi et laisse les cases cochées).` : '' };
}

async function disconnect(email) {
  let rt = null; try { rt = store.getSecret('google_rt_' + email); store.setSecret('google_rt_' + email, null); } catch { /* nom de secret inattendu : on retire quand même le compte */ }
  tokens.delete(email); cache.clear(); msgCache.clear();
  const s = store.settings.get();
  store.settings.replace({ ...s, google: { ...s.google, accounts: s.google.accounts.filter((a) => a !== email) } });
  if (rt) { // révocation côté Google (au mieux : l'effacement local est déjà fait)
    try { await rawFetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: rt }) }, 6000); } catch { /* hors ligne : jeton local effacé quand même */ }
  }
  return true;
}

// ---------- Jetons d'accès ----------
const tokens = new Map(), refreshing = new Map();
async function accessToken(email, force = false) {
  const c = tokens.get(email);
  if (!force && c && c.exp > Date.now() + 30000) return c.token;
  if (refreshing.has(email)) return refreshing.get(email);
  const p = (async () => {
    const rt = store.getSecret('google_rt_' + email);
    if (!rt) throw new GError('reauth', `Le compte Google ${email} n'est plus connecté : reconnecte-le.`, { reauth: true, email });
    try {
      const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: rt });
      tokens.set(email, { token: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3600) * 1000 });
      return t.access_token;
    } catch (e) { tokens.delete(email); if (e.reauth) e.email = email; throw e; }
  })();
  refreshing.set(email, p);
  try { return await p; } finally { refreshing.delete(email); }
}

function apiError(r, email) {
  const e = r.json?.error || {}, reason = e.errors?.[0]?.reason || e.status || '', msg = e.message || r.json?._raw || '';
  if (r.status === 401) return reauth(email);
  if (r.status === 403 || r.status === 429) {
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reason + ' ' + msg)) return new GError('apiOff', MSG.apiOff);
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(reason + ' ' + msg)) return new GError('scope', MSG.scope, { reauth: true, email });
    if (r.status === 429 || /rateLimit|dailyLimit|limit exceeded|quota|RESOURCE_EXHAUSTED/i.test(reason + ' ' + msg)) return new GError('quota', MSG.quota);
    return new GError('forbidden', 'Accès refusé par Google' + (msg ? ' : ' + msg : '.'));
  }
  if (r.status === 404) return new GError('notfound', 'Élément introuvable côté Google.');
  if (r.status >= 500) return new GError('server', 'Google est momentanément indisponible (erreur ' + r.status + ').');
  return new GError('google', 'Google : ' + (msg || r.status));
}
const retryable = (r) => r.status === 429 || r.status >= 500 || (r.status === 403 && /userRateLimitExceeded|rateLimitExceeded/i.test(JSON.stringify(r.json?.error?.errors || r.json?.error?.message || '')));

async function gget(email, url, tries = 4) {
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(email);
    const r = await slot(() => rawFetch(url, { headers: { authorization: 'Bearer ' + token } }));
    if (r.ok) return r.json;
    if (r.status === 401 && !refreshed) { refreshed = true; tokens.delete(email); continue; } // jeton périmé côté Google : un seul renouvellement
    if (retryable(r) && attempt < tries - 1) { await sleep(Math.min(8000, r.retryAfter ? r.retryAfter * 1000 : 500 * 2 ** attempt)); continue; }
    throw apiError(r, email);
  }
}

// ---------- Agenda ----------
const HEX = /^#[0-9a-f]{6}$/i;
const VIDEO_RE = /https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[a-z0-9.-]*zoom\.us\/[^\s"'<>)]+|teams\.microsoft\.com\/[^\s"'<>)]+|teams\.live\.com\/[^\s"'<>)]+|[a-z0-9.-]*webex\.com\/[^\s"'<>)]+|whereby\.com\/[^\s"'<>)]+|meet\.jit\.si\/[^\s"'<>)]+|[a-z0-9.-]*gotomeet(?:ing)?\.com\/[^\s"'<>)]+|[a-z0-9.-]*bluejeans\.com\/[^\s"'<>)]+)/i;
const httpsUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
function videoLink(e) {
  const direct = httpsUrl(e.hangoutLink); if (direct) return direct;
  for (const p of e.conferenceData?.entryPoints || []) if (p.entryPointType === 'video' && httpsUrl(p.uri)) return httpsUrl(p.uri);
  const m = VIDEO_RE.exec(String(e.location || '')) || VIDEO_RE.exec(String(e.description || '').replace(/&amp;/g, '&').slice(0, 8000));
  return m ? httpsUrl(m[0].replace(/[.,;]+$/, '')) : '';
}
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Transforme un événement Google en objet Jarvis ; null si à ignorer (annulé, refusé, hors période…).
function normalizeEvent(e, cal, email, range) {
  if (!e || e.status === 'cancelled') return null;
  const self = (e.attendees || []).find((a) => a.self);
  if (self?.responseStatus === 'declined') return { declined: true };
  if (e.eventType === 'workingLocation') return null;
  const s = parseWhen(e.start); if (!s) return null;
  let en = parseWhen(e.end);
  if (!en || en.ms < s.ms || (s.allDay && en.ms <= s.ms)) { const m = s.allDay ? String(e.start.date).split('-').map(Number) : null; en = { ms: m ? localToMs(m[0], m[1], m[2] + 1) : s.ms, allDay: s.allDay }; }
  const overlaps = s.ms < range.max && (en.ms > range.min || (en.ms === s.ms && s.ms >= range.min)); // fin exclusive
  if (!overlaps) return null;
  const att = (e.attendees || []).filter((a) => !a.resource);
  return {
    id: e.id, uid: e.iCalUID || e.id, account: email, calendar: cal.name, calendarId: cal.id, color: cal.color, primaryCal: !!cal.primary,
    title: cut(e.summary, 300) || '(sans titre)', start: s.allDay ? e.start.date : isoBrussels(s.ms), end: en.allDay ? e.end?.date || e.start.date : isoBrussels(en.ms),
    startMs: s.ms, endMs: en.ms, allDay: s.allDay, location: cut(e.location, 300), link: httpsUrl(e.htmlLink), video: videoLink(e),
    response: self?.responseStatus || '', organizer: !!(e.organizer?.self || self?.organizer), free: e.transparency === 'transparent', kind: e.eventType && e.eventType !== 'default' ? e.eventType : '',
    attendeeCount: att.length, attendees: att.slice(0, 20).map((a) => ({ name: cut(a.displayName || a.email, 80), status: a.responseStatus || '', self: !!a.self })),
    recurring: !!e.recurringEventId,
  };
}

async function listCalendars(email) {
  const out = []; let pageToken = '';
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ maxResults: '250', minAccessRole: 'reader', fields: 'nextPageToken,items(id,summary,summaryOverride,selected,hidden,deleted,primary,accessRole,backgroundColor)' }); if (pageToken) q.set('pageToken', pageToken);
    const r = await gget(email, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?' + q);
    out.push(...(r.items || [])); pageToken = r.nextPageToken; if (!pageToken) break;
  }
  return out.filter((c) => !c.deleted && !c.hidden && (c.primary || c.selected === true) && c.accessRole !== 'freeBusyReader')
    .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: HEX.test(c.backgroundColor || '') ? c.backgroundColor : '', primary: !!c.primary, readOnly: c.accessRole === 'reader' }));
}

const EVENT_FIELDS = 'nextPageToken,items(id,iCalUID,status,summary,start,end,location,description,htmlLink,hangoutLink,conferenceData/entryPoints(entryPointType,uri),attendees(self,responseStatus,displayName,email,organizer,resource),organizer/self,eventType,recurringEventId,transparency)';
async function calendarEvents(email, cal, range) {
  const out = []; let pageToken = '';
  for (let i = 0; i < 10 && out.length < 1000; i++) {
    const q = new URLSearchParams({ timeMin: new Date(range.min).toISOString(), timeMax: new Date(range.max).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeZone: TZ, fields: EVENT_FIELDS });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await gget(email, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
    out.push(...(r.items || [])); pageToken = r.nextPageToken; if (!pageToken) break;
  }
  return out;
}

const CACHE_TTL = 60000; const cache = new Map(), inflight = new Map();
async function events(days = 7, opts = {}) {
  days = Math.min(31, Math.max(1, Math.floor(Number(days)) || 7));
  const accts = [...new Set(store.settings.get().google.accounts)];
  const now = Date.now(), min = dayStart(0, now), max = dayStart(days, now);
  const key = `${accts.join('|')}#${days}#${dayKey(now)}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && now - hit.at < CACHE_TTL) return { ...hit.value, events: hit.value.events.slice(), cached: true };
  if (inflight.has(key) && !opts.fresh) { const v = await inflight.get(key); return { ...v, events: v.events.slice() }; }
  const run = (async () => {
    const range = { min, max }, errors = [], errorDetails = [], found = []; let declined = 0, calendars = [];
    const fail = (email, e, where) => { if (e.reauth && errorDetails.some((d) => d.account === email && d.reauth)) return; const text = `${email}${where ? ' › ' + where : ''} : ${e.message}`; if (!errors.includes(text)) errors.push(text); errorDetails.push({ account: email, code: e.code || 'google', reauth: !!e.reauth, message: e.message }); };
    const perAccount = await pool(accts, 3, async (email) => {
      try { return { email, cals: await listCalendars(email) }; } catch (e) { fail(email, e); return { email, cals: [] }; }
    });
    const tasks = perAccount.flatMap(({ email, cals }) => cals.map((cal) => ({ email, cal })));
    calendars = perAccount.flatMap(({ email, cals }) => cals.map((c) => ({ account: email, id: c.id, name: c.name, color: c.color })));
    const failedAcct = new Set(errorDetails.filter((d) => d.reauth).map((d) => d.account));
    await pool(tasks, 5, async ({ email, cal }) => {
      if (failedAcct.has(email)) return;
      try {
        for (const raw of await calendarEvents(email, cal, range)) { const n = normalizeEvent(raw, cal, email, range); if (!n) continue; if (n.declined) { declined++; continue; } found.push(n); }
      } catch (e) { if (e.reauth) failedAcct.add(email); fail(email, e, cal.primary ? '' : cal.name); }
    });
    // Dédoublonnage : même événement (iCalUID + début) présent dans plusieurs agendas / comptes.
    const rank = (e) => (e.response ? 0 : 2) + (e.primaryCal ? 0 : 1); // on garde la version la plus informative (réponse connue, agenda principal), de façon déterministe
    found.sort((a, b) => rank(a) - rank(b) || a.account.localeCompare(b.account) || a.calendar.localeCompare(b.calendar));
    const byKey = new Map();
    for (const e of found) {
      const k = e.uid + '|' + e.startMs, prev = byKey.get(k);
      if (!prev) { byKey.set(k, e); continue; }
      prev.alsoIn = [...(prev.alsoIn || []), e.calendar].filter((c, i, a) => c !== prev.calendar && a.indexOf(c) === i);
      if (!prev.video && e.video) prev.video = e.video; if (!prev.response && e.response) prev.response = e.response;
    }
    const list = [...byKey.values()].sort((a, b) => a.startMs - b.startMs || (b.allDay - a.allDay) || a.endMs - b.endMs || a.title.localeCompare(b.title, 'fr'));
    const value = { events: list, errors, errorDetails, declined, calendars, range: { from: isoBrussels(min), to: isoBrussels(max - 1), days, tz: TZ }, fetchedAt: new Date().toISOString(), cached: false };
    if (!errors.length) cache.set(key, { at: Date.now(), value }); // on ne met pas en cache un résultat partiel
    return value;
  })();
  inflight.set(key, run);
  try { const v = await run; return { ...v, events: v.events.slice() }; } finally { inflight.delete(key); }
}

// ---------- Gmail (lecture seule) ----------
function decodeWords(s) { // RFC 2047 : =?charset?B|Q?texte?=
  s = String(s || ''); if (!s.includes('=?')) return s;
  return s.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, cs, enc, txt) => {
    try {
      const buf = enc.toLowerCase() === 'b' ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return decodeBytes(buf, cs);
    } catch { return txt; }
  });
}
function decodeBytes(buf, charset) {
  try { return new TextDecoder(String(charset || 'utf-8').replace(/^"|"$/g, '').trim() || 'utf-8').decode(buf); } catch { return buf.toString('utf8'); }
}
const MAX_PART = 600000;
function decodeBody(payload) {
  const texts = [], htmls = [];
  const hdr = (p, n) => (p.headers || []).find((h) => String(h.name).toLowerCase() === n)?.value || '';
  const walk = (p, depth) => {
    if (!p || depth > 20) return;
    const type = String(p.mimeType || '').toLowerCase();
    const attachment = !!p.filename || /attachment/i.test(hdr(p, 'content-disposition'));
    if (p.body?.data && !attachment && (type === 'text/plain' || type === 'text/html')) {
      const cs = (/charset="?([^";\s]+)/i.exec(hdr(p, 'content-type')) || [])[1];
      (type === 'text/html' ? htmls : texts).push(decodeBytes(Buffer.from(p.body.data, 'base64url').subarray(0, MAX_PART), cs));
    }
    for (const c of p.parts || []) walk(c, depth + 1);
  };
  walk(payload, 0);
  let text = texts.join('\n\n'), html = htmls.join('\n');
  if (!text && !html && payload?.body?.data) { const t = decodeBytes(Buffer.from(payload.body.data, 'base64url').subarray(0, MAX_PART), (/charset="?([^";\s]+)/i.exec(hdr(payload, 'content-type')) || [])[1]); if (/^\s*</.test(t)) html = t; else text = t; }
  return { text, html };
}
function attachmentNames(payload) {
  const out = []; const walk = (p, d) => { if (!p || d > 20) return; if (p.filename) out.push(p.filename); for (const c of p.parts || []) walk(c, d + 1); }; walk(payload, 0); return out;
}

const msgCache = new Map(); // id → { at, g } : corps de message (immuable) gardé 5 min ; seuls les libellés sont relus
const MSG_TTL = 300000, MSG_MAX = 120;
function toMessage(email, g) {
  const h = Object.fromEntries((g.payload?.headers || []).map((x) => [String(x.name).toLowerCase(), x.value]));
  const b = decodeBody(g.payload || {});
  let date = ''; const t = h.date ? new Date(h.date) : null;
  if (t && !isNaN(t)) date = t.toISOString(); else if (g.internalDate && !isNaN(Number(g.internalDate))) date = new Date(Number(g.internalDate)).toISOString();
  return require('./mailtext').normalize({ id: g.id, account: 'google:' + email, from: decodeWords(h.from || ''), replyTo: decodeWords(h['reply-to'] || ''), to: decodeWords(h.to || ''), subject: decodeWords(h.subject || '') || '(sans objet)', date,
    unread: (g.labelIds || []).includes('UNREAD'), text: b.text || (b.html ? '' : (g.snippet || '')), html: b.html, messageId: h['message-id'] || '', references: h.references || '', listId: h['list-id'] || '', listUnsubscribe: !!h['list-unsubscribe'], bulk: /bulk|list|junk/i.test(h.precedence || '') || /auto-(generated|replied)/i.test(h['auto-submitted'] || '') || (g.labelIds || []).some((l) => /^CATEGORY_(PROMOTIONS|SOCIAL|UPDATES|FORUMS)$/.test(l)), attachments: attachmentNames(g.payload) });
}

async function gmailRead(email, limit = 10, query = 'in:inbox') {
  limit = Math.min(50, Math.max(1, Math.floor(Number(limit)) || 10));
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  const list = await gget(email, `${base}?${new URLSearchParams({ maxResults: String(limit), q: String(query || 'in:inbox'), fields: 'messages(id)' })}`);
  const ids = (list.messages || []).map((m) => m.id).filter(Boolean);
  const now = Date.now(); let failure = null;
  const got = await pool(ids, 4, async (id) => {
    try {
      const c = msgCache.get(email + '|' + id);
      if (c && now - c.at < MSG_TTL) { // déjà lu : on ne relit que les libellés (lu / non lu), réponse minuscule
        const m = await gget(email, `${base}/${encodeURIComponent(id)}?${new URLSearchParams({ format: 'minimal', fields: 'id,labelIds' })}`);
        return toMessage(email, { ...c.g, labelIds: m.labelIds || [] });
      }
      const g = await gget(email, `${base}/${encodeURIComponent(id)}?format=full`);
      msgCache.set(email + '|' + id, { at: Date.now(), g }); if (msgCache.size > MSG_MAX) msgCache.delete(msgCache.keys().next().value);
      return toMessage(email, g);
    } catch (e) { if (e.reauth || e.code === 'quota' || e.code === 'network') throw e; failure = failure || e; return null; } // message supprimé entre-temps : on l'ignore
  });
  const out = got.filter(Boolean);
  if (ids.length && !out.length && failure) throw failure;
  return out;
}

module.exports = { connect, disconnect, cancel, events, gmailRead, decodeBody, setOpener, validClientId,
  _t: { dayStart, localToMs, isoBrussels, dayKey, parseWhen, normalizeEvent, decodeWords, reset: () => { tokens.clear(); cache.clear(); inflight.clear(); msgCache.clear(); }, setSleep: (f) => { sleep = f; } } };
