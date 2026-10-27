// Connexion native Google (OAuth « application de bureau », PKCE, redirection locale) : Agenda + Gmail en lecture seule.
const http = require('http');
const crypto = require('crypto');
const store = require('./store');

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly'];
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let openExternal = async () => {};
const setOpener = (fn) => { openExternal = fn; };

function creds() {
  const g = store.settings.get().google;
  const secret = store.getSecret('google_client_secret');
  if (!g.clientId) throw new Error('Renseigne d\'abord l\'identifiant client Google (voir le guide dans l\'onglet Agenda).');
  return { id: g.clientId, secret };
}

async function tokenCall(params) {
  const { id, secret } = creds();
  const body = new URLSearchParams({ client_id: id, ...(secret ? { client_secret: secret } : {}), ...params });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!r.ok) throw new Error('Google : ' + (j.error_description || j.error || r.status));
  return j;
}

async function connect() {
  const { id } = creds();
  const verifier = b64u(crypto.randomBytes(48));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(16));
  const server = http.createServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const codePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error('Délai dépassé : connexion Google non terminée (3 min).')); }, 180000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirect);
      const code = u.searchParams.get('code'), err = u.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:-apple-system;text-align:center;padding:80px"><h2>Jarvis Parlement</h2><p>' + (code ? 'Connexion réussie. Tu peux fermer cet onglet.' : 'Connexion annulée.') + '</p></body></html>');
      if (u.pathname !== '/' && !code && !err) return;
      clearTimeout(timer); server.close();
      if (u.searchParams.get('state') !== state && code) return reject(new Error('Réponse Google invalide (state).'));
      code ? resolve(code) : reject(new Error('Connexion Google refusée : ' + (err || 'inconnue')));
    });
  });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account', state });
  await openExternal(url);
  const code = await codePromise;
  const tok = await tokenCall({ code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect });
  const info = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: 'Bearer ' + tok.access_token } })).json();
  const email = info.email; if (!email) throw new Error('Adresse Google introuvable.');
  if (tok.refresh_token) store.setSecret('google_rt_' + email, tok.refresh_token);
  const s = store.settings.get();
  if (!s.google.accounts.includes(email)) store.settings.set({ google: { accounts: [...s.google.accounts, email] } });
  return { email };
}

function disconnect(email) {
  store.setSecret('google_rt_' + email, null);
  const s = store.settings.get();
  store.settings.replace({ ...s, google: { ...s.google, accounts: s.google.accounts.filter((a) => a !== email) } });
  return true;
}

const tokens = new Map();
async function accessToken(email) {
  const c = tokens.get(email);
  if (c && c.exp > Date.now() + 30000) return c.token;
  const rt = store.getSecret('google_rt_' + email);
  if (!rt) throw new Error(`Compte Google ${email} non connecté.`);
  const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: rt });
  tokens.set(email, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

async function gget(email, url) {
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + await accessToken(email) } });
  const j = await r.json();
  if (!r.ok) throw new Error('Google : ' + (j.error?.message || r.status));
  return j;
}

async function events(days = 7) {
  const accts = store.settings.get().google.accounts; const out = []; const errors = [];
  const min = new Date(); min.setHours(0, 0, 0, 0);
  const max = new Date(min.getTime() + days * 864e5);
  for (const email of accts) {
    try {
      const cals = (await gget(email, 'https://www.googleapis.com/calendar/v3/users/me/calendarList')).items || [];
      for (const c of cals.filter((x) => x.selected !== false)) {
        const q = new URLSearchParams({ timeMin: min.toISOString(), timeMax: max.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
        const ev = await gget(email, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`);
        for (const e of ev.items || []) out.push({ id: e.id, account: email, calendar: c.summaryOverride || c.summary, title: e.summary || '(sans titre)', start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, allDay: !e.start?.dateTime, location: e.location || '', link: e.htmlLink });
      }
    } catch (e) { errors.push(`${email} : ${e.message}`); }
  }
  out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { events: out, errors };
}

function decodeBody(payload) {
  const find = (p, type) => {
    if (p.mimeType === type && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8');
    for (const c of p.parts || []) { const t = find(c, type); if (t) return t; }
    return '';
  };
  let text = find(payload, 'text/plain'), html = find(payload, 'text/html');
  if (!text && !html && payload.body?.data) { const t = Buffer.from(payload.body.data, 'base64url').toString('utf8'); if (/^\s*</.test(t)) html = t; else text = t; }
  return { text, html };
}

async function gmailRead(email, limit = 10, query = 'in:inbox') {
  const list = await gget(email, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ maxResults: String(limit), q: query })}`);
  const out = [];
  for (const m of list.messages || []) {
    const g = await gget(email, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`);
    const h = Object.fromEntries((g.payload.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    const b = decodeBody(g.payload);
    out.push(require('./mailtext').normalize({ id: m.id, account: 'google:' + email, from: h.from || '', replyTo: h['reply-to'] || '', to: h.to || '', subject: h.subject || '(sans objet)', date: h.date ? new Date(h.date).toISOString() : '', unread: (g.labelIds || []).includes('UNREAD'),
      text: b.text || (b.html ? '' : (g.snippet || '')), html: b.html, messageId: h['message-id'] || '', references: h.references || '' }));
  }
  return out;
}

module.exports = { connect, disconnect, events, gmailRead, setOpener };
