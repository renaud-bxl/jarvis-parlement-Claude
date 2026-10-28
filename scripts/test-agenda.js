// Tests du volet Google (Agenda + Gmail) : fuseaux, événements, pagination, jetons, erreurs, OAuth. fetch est simulé. Lancer : node scripts/test-agenda.js
process.env.JARVIS_INSECURE_SECRETS = '1'; // tests automatisés uniquement : pas de trousseau macOS ici
process.env.TZ = 'Pacific/Auckland'; // fuseau du Mac volontairement très éloigné de Bruxelles : le code doit s'en moquer
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const crypto = require('crypto'); const nodeHttp = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agenda-'));
process.env.JARVIS_DATA_DIR = path.join(tmp, 'data'); process.env.JARVIS_DOCS_DIR = path.join(tmp, 'Jarvis-Parlement');

const store = require('../src/store'); const google = require('../src/google'); const T = google._t;
T.setSleep(async () => {}); // pas d'attente réelle lors des nouvelles tentatives
const CID = '123456789012-abcdefghij123456.apps.googleusercontent.com';
const log = []; let handlers = []; let inflightNow = 0, inflightMax = 0;
const json = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });
global.fetch = async (url, opts = {}) => {
  url = String(url); log.push({ url, opts });
  inflightNow++; inflightMax = Math.max(inflightMax, inflightNow);
  try {
    await new Promise((r) => setTimeout(r, 5));
    for (const h of handlers) { const r = h(url, opts); if (r) return r; }
    return json(404, { error: { message: 'non géré : ' + url } });
  } finally { inflightNow--; }
};
const calls = (re) => log.filter((l) => re.test(l.url));
const qs = (url) => new URL(url).searchParams;

(async () => {
  const ok = (m) => console.log('  ✓', m);
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Fuseau Europe/Brussels ----------
  const at = (iso) => Date.parse(iso);
  assert.strictEqual(new Date(T.dayStart(0, at('2026-01-15T12:00:00Z'))).toISOString(), '2026-01-14T23:00:00.000Z'); // hiver : UTC+1
  assert.strictEqual(new Date(T.dayStart(0, at('2026-07-15T12:00:00Z'))).toISOString(), '2026-07-14T22:00:00.000Z'); // été : UTC+2
  ok('début de journée = minuit de Bruxelles (hiver UTC+1, été UTC+2), même si le Mac est à Auckland');
  assert.strictEqual(new Date(T.dayStart(0, at('2026-01-14T23:30:00Z'))).toISOString(), '2026-01-14T23:00:00.000Z'); // 00:30 à Bruxelles = déjà le 15
  assert.strictEqual(new Date(T.dayStart(0, at('2026-01-14T22:30:00Z'))).toISOString(), '2026-01-13T23:00:00.000Z'); // 23:30 à Bruxelles = encore le 14
  ok('la bascule de jour suit l\'heure de Bruxelles (00:30 → nouveau jour, 23:30 → jour précédent)');
  const o25 = at('2026-10-25T12:00:00Z'); // dimanche du passage à l'heure d'hiver : journée de 25 h
  assert.strictEqual(T.dayStart(1, o25) - T.dayStart(0, o25), 25 * 3600e3); assert.strictEqual(new Date(T.dayStart(1, o25)).toISOString(), '2026-10-25T23:00:00.000Z');
  const m29 = at('2026-03-29T12:00:00Z'); // passage à l'heure d'été : journée de 23 h
  assert.strictEqual(T.dayStart(1, m29) - T.dayStart(0, m29), 23 * 3600e3);
  ok('jours de changement d\'heure : 25 h (octobre) et 23 h (mars) calculés correctement');
  assert.strictEqual(T.isoBrussels(at('2026-07-15T07:30:00Z')), '2026-07-15T09:30:00+02:00'); assert.strictEqual(T.isoBrussels(at('2026-01-15T07:30:00Z')), '2026-01-15T08:30:00+01:00'); ok('affichage ISO avec le bon décalage (+01:00 / +02:00)');
  assert.strictEqual(T.parseWhen({ dateTime: '2026-07-15T09:30:00' }).ms, at('2026-07-15T07:30:00Z')); ok('une heure sans décalage est interprétée comme heure de Bruxelles');

  // ---------- Événements ----------
  store.settings.set({ google: { clientId: CID, accounts: ['ana@exemple.be', 'bob@exemple.be'] } });
  store.setSecret('google_client_secret', 'GOCSPX-test'); store.setSecret('google_rt_ana@exemple.be', 'rt-ana'); store.setSecret('google_rt_bob@exemple.be', 'rt-bob');
  const now = Date.now(); const min0 = T.dayStart(0, now), dKey = T.dayKey(now), nextKey = T.dayKey(T.dayStart(1, now));
  const tdy = (h, m = 0) => T.isoBrussels(T.localToMs(...dKey.split('-').map(Number), h, m));
  const ev = (o) => ({ id: o.id, iCalUID: o.uid || o.id + '@g', status: 'confirmed', summary: o.id, start: { dateTime: tdy(9) }, end: { dateTime: tdy(10) }, ...o });
  let tokenCalls = 0, expireNext = false, throttle = 0, flaky401 = 0; let bobMode = 'ok';
  const calendarListPage1 = { items: [{ id: 'ana@exemple.be', summary: 'ana@exemple.be', primary: true, selected: true, accessRole: 'owner', backgroundColor: '#9fc6e7' }, { id: 'caché', summary: 'Caché', hidden: true, selected: true, accessRole: 'reader' }, { id: 'nonsel', summary: 'Non sélectionné', accessRole: 'reader' }], nextPageToken: 'P2' };
  const calendarListPage2 = { items: [{ id: 'commission', summary: 'Commission Mobilité', summaryOverride: 'Mobilité', selected: true, accessRole: 'reader', backgroundColor: 'rouge-pas-hex' }, { id: 'busy', summary: 'Occupé', selected: true, accessRole: 'freeBusyReader' }] };
  handlers = [
    (u, o) => { if (!u.startsWith('https://oauth2.googleapis.com/token')) return; const b = new URLSearchParams(String(o.body)); tokenCalls++;
      if (b.get('grant_type') === 'refresh_token') { if (b.get('refresh_token') === 'rt-bob' && bobMode === 'revoked') return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }); return json(200, { access_token: 'at-' + b.get('refresh_token') + '-' + tokenCalls, expires_in: expireNext ? 1 : 3600 }); } },
    (u, o) => { if (!u.includes('/calendarList')) return; const t = o.headers.authorization; if (t.includes('rt-bob')) return json(200, { items: [{ id: 'bob@exemple.be', summary: 'Bob', primary: true, accessRole: 'owner' }] }); if (flaky401 > 0) { flaky401--; return json(401, { error: { message: 'Invalid Credentials' } }); } return qs(u).get('pageToken') === 'P2' ? json(200, calendarListPage2) : json(200, calendarListPage1); },
    (u, o) => { const m = /calendars\/([^/]+)\/events\?/.exec(u); if (!m) return; const cal = decodeURIComponent(m[1]); const pt = qs(u).get('pageToken');
      if (throttle > 0) { throttle--; return json(429, { error: { message: 'Rate Limit Exceeded' } }, { 'retry-after': '1' }); }
      if (cal === 'ana@exemple.be' && !pt) return json(200, { items: [ev({ id: 'seance', summary: 'Séance plénière', uid: 'u1', location: 'Hémicycle', hangoutLink: 'https://meet.google.com/abc-defg-hij', start: { dateTime: tdy(14) }, end: { dateTime: tdy(17) }, attendees: [{ self: true, responseStatus: 'accepted' }, { displayName: 'Léa', responseStatus: 'needsAction' }, { displayName: 'Salle A', resource: true }] }), ev({ id: 'annule', status: 'cancelled' }), ev({ id: 'refuse', attendees: [{ self: true, responseStatus: 'declined' }] }), ev({ id: 'jour', summary: 'Journée d\'étude', uid: 'u2', start: { date: dKey }, end: { date: nextKey } })], nextPageToken: 'E2' });
      if (cal === 'ana@exemple.be' && pt === 'E2') return json(200, { items: [ev({ id: 'matin', summary: 'Café avec le chef de groupe', start: { dateTime: tdy(8, 30) }, end: { dateTime: tdy(9) }, location: 'Réunion Teams : https://teams.microsoft.com/l/meetup-join/xyz' })] });
      if (cal === 'commission') return json(200, { items: [ev({ id: 'seance-bis', summary: 'Séance plénière', uid: 'u1', start: { dateTime: tdy(14) }, end: { dateTime: tdy(17) } }), ev({ id: 'multi', summary: 'Mission Strasbourg', uid: 'u3', start: { date: dKey }, end: { date: T.dayKey(T.dayStart(3, now)) } })] });
      if (cal === 'bob@exemple.be') return bobMode === 'quota' ? json(403, { error: { errors: [{ reason: 'dailyLimitExceeded' }], message: 'Daily Limit Exceeded' } }) : json(200, { items: [ev({ id: 'bob1', summary: 'Rendez-vous de Bob', start: { dateTime: tdy(11) }, end: { dateTime: tdy(12) } })] });
      return json(404, { error: { message: 'calendrier inconnu ' + cal } }); },
  ];
  let r = await google.events(7);
  const titles = r.events.map((e) => e.title);
  assert.deepStrictEqual(r.errors, []); assert(!titles.includes('annule') && !titles.includes('refuse')); assert.strictEqual(r.declined, 1); ok('événements annulés ignorés, refusés écartés (compteur conservé)');
  assert.strictEqual(r.events.filter((e) => e.title === 'Séance plénière').length, 1); assert.deepStrictEqual(r.events.find((e) => e.title === 'Séance plénière').alsoIn, ['Mobilité']); ok('événement présent dans 2 agendas : dédoublonné, 2e agenda mémorisé');
  assert.strictEqual(calls(/calendarList/).filter((c) => c.opts.headers.authorization.includes('rt-ana')).length, 2); ok('liste d\'agendas paginée (2 pages)');
  assert(!calls(/events\?/).some((c) => /caché|nonsel|busy/.test(decodeURIComponent(c.url)))); assert(r.calendars.some((c) => c.name === 'Mobilité')); ok('agendas masqués / non sélectionnés / « libre-occupé » non interrogés ; nom personnalisé utilisé');
  assert(titles.includes('Café avec le chef de groupe')); ok('pagination des événements (nextPageToken) suivie');
  const evCall = qs(calls(/calendars\/ana.*events\?/)[0].url);
  assert.strictEqual(new Date(evCall.get('timeMin')).getTime(), min0); assert.strictEqual(new Date(evCall.get('timeMax')).getTime(), T.dayStart(7, now)); assert(evCall.get('singleEvents') === 'true' && evCall.get('orderBy') === 'startTime' && evCall.get('timeZone') === 'Europe/Brussels' && evCall.get('maxResults') === '250'); ok('timeMin/timeMax = minuit de Bruxelles, singleEvents + orderBy, timeZone Europe/Brussels');
  const order = r.events.filter((e) => !e.allDay).map((e) => e.startMs); assert.deepStrictEqual(order, [...order].sort((a, b) => a - b)); assert(r.events[0].allDay, 'les « toute la journée » passent en tête du jour'); ok('tri chronologique fiable sur l\'instant réel (pas sur la chaîne), journées entières d\'abord');
  const jour = r.events.find((e) => e.title === 'Journée d\'étude'); assert(jour.allDay && jour.start === dKey && jour.end === nextKey && jour.endMs - jour.startMs >= 23 * 3600e3 && jour.startMs === min0); ok('événement « toute la journée » : date de début, fin exclusive, instants = minuits de Bruxelles');
  const multi = r.events.find((e) => e.title === 'Mission Strasbourg'); assert.strictEqual(multi.endMs, T.dayStart(3, now)); ok('événement sur plusieurs jours : fin exclusive conservée');
  assert.strictEqual(r.events.find((e) => e.title === 'Séance plénière').video, 'https://meet.google.com/abc-defg-hij'); assert.strictEqual(r.events.find((e) => e.title.startsWith('Café')).video, 'https://teams.microsoft.com/l/meetup-join/xyz'); ok('lien de visioconférence : Meet (hangoutLink) et Teams trouvé dans le lieu');
  const sp = r.events.find((e) => e.title === 'Séance plénière'); assert(sp.attendeeCount === 2 && sp.response === 'accepted' && sp.color === '#9fc6e7' && sp.start.endsWith('+01:00') || sp.start.endsWith('+02:00')); ok('participants (hors salles), statut, couleur de l\'agenda, heure avec décalage de Bruxelles');
  // cache 60 s
  const n0 = log.length; const r2 = await google.events(7); assert.strictEqual(log.length, n0); assert(r2.cached); await google.events(7, { fresh: true }); assert(log.length > n0); ok('cache mémoire 60 s (aucun appel réseau), contournable avec fresh');
  assert(inflightMax > 1 && inflightMax <= 6, 'parallélisme borné : ' + inflightMax); ok(`appels en parallèle bornés (pic observé : ${inflightMax} requêtes simultanées, limite 6)`);

  // jeton : refresh, expiration, 401
  T.reset(); tokenCalls = 0; await google.events(1); const t1 = tokenCalls; assert(t1 >= 1 && t1 <= 2, 'un seul renouvellement par compte malgré les appels parallèles : ' + t1); ok('renouvellement du jeton dédoublonné (appels parallèles → 1 seul refresh par compte)');
  T.reset(); store.settings.set({ google: { accounts: ['ana@exemple.be'] } }); tokenCalls = 0; flaky401 = 1; r = await google.events(1); assert.deepStrictEqual(r.errors, []); assert(tokenCalls >= 2); ok('401 en cours de route : jeton renouvelé automatiquement une fois puis succès');
  T.reset(); throttle = 2; r = await google.events(1); assert.deepStrictEqual(r.errors, []); assert(r.events.length > 0); ok('429 (limite de débit) : nouvelles tentatives avec attente (Retry-After) puis succès');
  T.reset(); throttle = 99; r = await google.events(1); assert(r.errors.length && /limite temporairement|quota/i.test(r.errors[0])); throttle = 0; ok('429 persistant : message clair en français, pas de plantage');

  // plusieurs comptes, erreurs partielles
  T.reset(); store.settings.set({ google: { accounts: ['ana@exemple.be', 'bob@exemple.be'] } }); bobMode = 'revoked'; r = await google.events(3);
  assert(r.events.some((e) => e.account === 'ana@exemple.be')); assert.strictEqual(r.errors.length, 1); assert(/bob@exemple.be/.test(r.errors[0]) && /Reconnecte/.test(r.errors[0])); assert.deepStrictEqual(r.errorDetails.map((d) => [d.account, d.code, d.reauth]), [['bob@exemple.be', 'reauth', true]]); ok('invalid_grant (accès révoqué) sur un compte : message + reconnexion proposée, l\'autre compte reste affiché');
  assert.strictEqual((await google.events(3)).cached, false); ok('un résultat partiel n\'est pas mis en cache (la reconnexion se voit tout de suite)');
  T.reset(); bobMode = 'quota'; r = await google.events(3); assert(r.events.some((e) => e.account === 'ana@exemple.be') && /bob/.test(r.errors[0]) && /quota|limite/i.test(r.errors[0])); ok('403 quota journalier sur un agenda : erreur isolée, le reste fonctionne');
  T.reset(); bobMode = 'ok'; store.setSecret('google_rt_bob@exemple.be', null); r = await google.events(3); assert(/n'est plus connecté/.test(r.errors[0]) && r.errorDetails[0].reauth); store.setSecret('google_rt_bob@exemple.be', 'rt-bob'); ok('refresh_token absent : message clair + reconnexion proposée');
  T.reset(); const keep = handlers; handlers = [(u) => u.includes('oauth2') ? json(200, { access_token: 'x', expires_in: 3600 }) : json(403, { error: { errors: [{ reason: 'accessNotConfigured' }], message: 'Google Calendar API has not been used in project 1 before or it is disabled.' } })];
  r = await google.events(1); assert(/n'est pas activée/.test(r.errors.join(' '))); handlers = keep; ok('API Calendar non activée dans Google Cloud : message explicite');
  T.reset(); handlers = [(u) => u.includes('oauth2') ? json(401, { error: 'invalid_client', error_description: 'Unauthorized' }) : null]; r = await google.events(1); assert(/Identifiants Google invalides/.test(r.errors[0])); handlers = keep; ok('invalid_client : « identifiants Google invalides »');
  global.fetch = (async (orig) => async (u, o) => { if (String(u).includes('calendar')) throw new TypeError('fetch failed'); return orig(u, o); })(global.fetch); T.reset(); r = await google.events(1); assert(/Impossible de joindre Google/.test(r.errors[0])); ok('réseau coupé : message clair');
  // (restaurer le fetch simulé)
  global.fetch = async (url, opts = {}) => { url = String(url); log.push({ url, opts }); inflightNow++; inflightMax = Math.max(inflightMax, inflightNow); try { await new Promise((r) => setTimeout(r, 5)); for (const h of handlers) { const x = h(url, opts); if (x) return x; } return json(404, { error: { message: 'non géré : ' + url } }); } finally { inflightNow--; } };
  handlers = keep;

  // ---------- Gmail ----------
  T.reset(); store.settings.set({ google: { accounts: ['ana@exemple.be'] } });
  const b64 = (buf) => Buffer.from(buf).toString('base64url');
  const msgs = {
    m1: { id: 'm1', labelIds: ['INBOX', 'UNREAD'], snippet: 'snip', internalDate: '1792000000000', payload: { mimeType: 'multipart/alternative', headers: [{ name: 'Subject', value: '=?UTF-8?B?' + Buffer.from('Question évêque député').toString('base64') + '?=' }, { name: 'From', value: 'Jean <jean@exemple.be>' }, { name: 'Date', value: 'Tue, 27 Oct 2026 20:03:00 +0100' }], parts: [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' }], body: { data: b64(Buffer.from('Bonjour, été à Bruxelles', 'latin1')) } }, { mimeType: 'text/html', body: { data: b64('<p>Bonjour</p>') } }] } },
    m2: { id: 'm2', labelIds: ['INBOX'], snippet: 'Sans date', internalDate: '1792000000000', payload: { mimeType: 'text/plain', headers: [{ name: 'Date', value: 'pas une date' }, { name: 'Subject', value: 'Test' }], body: { data: b64('Corps simple') } } },
  };
  let gmailMode = 'ok';
  handlers = [(u, o) => u.startsWith('https://oauth2') ? json(200, { access_token: 'g1', expires_in: 3600 }) : null,
    (u) => { if (!u.startsWith('https://gmail.googleapis.com')) return; if (/messages\?/.test(u)) return json(200, { messages: [{ id: 'm1' }, { id: 'gone' }, { id: 'm2' }] }); const id = /messages\/([^?]+)/.exec(u)[1]; if (id === 'gone') return json(404, { error: { message: 'Not Found' } }); if (qs(u).get('format') === 'minimal') return json(200, { id, labelIds: gmailMode === 'read' ? ['INBOX'] : ['INBOX', 'UNREAD'] }); return json(200, msgs[id]); }];
  const gm = await google.gmailRead('ana@exemple.be', 5);
  assert.strictEqual(gm.length, 2); assert.strictEqual(gm[0].subject, 'Question évêque député'); assert(gm[0].text.includes('été à Bruxelles') && gm[0].unread && gm[0].date === '2026-10-27T19:03:00.000Z' && gm[0].account === 'google:ana@exemple.be'); ok('Gmail : texte ISO-8859-1 décodé (accents), objet encodé RFC 2047 décodé, date et non-lu corrects, un message supprimé n\'empêche pas la lecture');
  assert(/^\d{4}-/.test(gm[1].date) && gm[1].text === 'Corps simple'); ok('Gmail : date illisible → repli sur internalDate (avant : exception sur tout le lot)');
  assert.strictEqual(calls(/format=full/).length, 3); const n1 = log.length; gmailMode = 'read'; const gm2 = await google.gmailRead('ana@exemple.be', 5); assert.strictEqual(calls(/format=full/).length, 4); /* +1 : le message supprimé est retenté */ assert(calls(/format=minimal/).length === 2 && log.length - n1 <= 5); assert.strictEqual(gm2[0].unread, false); ok('Gmail : relecture sans retélécharger les corps (seuls les libellés « lu / non lu » sont relus)');
  const dec = google.decodeBody({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain', body: { data: b64('Texte') } }, { mimeType: 'text/plain', filename: 'note.txt', body: { data: b64('PIECE JOINTE') } }] }); assert.strictEqual(dec.text, 'Texte'); ok('Gmail : les pièces jointes texte ne sont plus prises pour le corps du message');
  handlers = [(u) => u.startsWith('https://oauth2') ? json(200, { access_token: 'g1', expires_in: 3600 }) : json(403, { error: { errors: [{ reason: 'insufficientPermissions' }], message: 'Request had insufficient authentication scopes.' } })]; T.reset();
  await assert.rejects(() => google.gmailRead('ana@exemple.be', 3), (e) => e.reauth && /Autorisation manquante/.test(e.message)); ok('Gmail : autorisation de lecture non accordée → message clair + reconnexion');

  // ---------- Connexion OAuth (boucle locale, PKCE, state) ----------
  T.reset(); store.settings.set({ google: { accounts: [] } });
  const get = (url, headers) => new Promise((res, rej) => { nodeHttp.get(url, { headers, agent: false }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res({ status: r.statusCode, body: d, headers: r.headers })); }).on('error', rej); });
  let tokenBody = null, tokenResp, revoked = null;
  handlers = [(u, o) => { if (u.startsWith('https://oauth2.googleapis.com/token')) { tokenBody = new URLSearchParams(String(o.body)); return json(200, tokenResp()); } if (u.startsWith('https://openidconnect')) return json(200, { email: 'Camille@Exemple.be' }); if (u.startsWith('https://oauth2.googleapis.com/revoke')) { revoked = new URLSearchParams(String(o.body)).get('token'); return json(200, {}); } }];
  tokenResp = () => ({ access_token: 'a1', refresh_token: 'rt-camille', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly' });
  const start = () => { const q = google.connect(); q.catch(() => {}); return q; }; let authUrl = null; google.setOpener(async (u) => { authUrl = new URL(u); });
  let p = start(); await settle(100);
  const q = authUrl.searchParams, redirect = q.get('redirect_uri'), state = q.get('state');
  assert(q.get('code_challenge_method') === 'S256' && q.get('response_type') === 'code' && q.get('access_type') === 'offline' && /^http:\/\/127\.0\.0\.1:\d+$/.test(redirect)); assert.deepStrictEqual(q.get('scope').split(' ').sort(), ['email', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly', 'openid']); ok('URL d\'autorisation : PKCE S256, redirection 127.0.0.1, scopes en lecture seule uniquement');
  let bad = await get(redirect + '/?code=evil&state=faux'); assert.strictEqual(bad.status, 400); bad = await get(redirect + '/favicon.ico'); assert.strictEqual(bad.status, 404); bad = await get(redirect + '/?code=evil'); assert.strictEqual(bad.status, 400); ok('mauvais ou absent `state`, favicon : refusés sans interrompre la vraie connexion (aucun échange de code)');
  assert.strictEqual(tokenBody, null);
  const good = await get(redirect + '/?code=le-code&state=' + state); assert.strictEqual(good.status, 200); assert(/Connexion réussie/.test(good.body) && /lang="fr"/.test(good.body) && !good.headers['content-security-policy'].includes('script')); ok('page de retour en français, sans script');
  const res = await p; assert.strictEqual(res.email, 'camille@exemple.be'); assert(!res.warning);
  assert.strictEqual(tokenBody.get('code'), 'le-code'); assert.strictEqual(b64uSha(tokenBody.get('code_verifier')), q.get('code_challenge')); assert.strictEqual(tokenBody.get('client_secret'), 'GOCSPX-test'); ok('échange du code : code_verifier correspond au code_challenge (PKCE)');
  assert.strictEqual(store.getSecret('google_rt_camille@exemple.be'), 'rt-camille'); assert.deepStrictEqual(store.settings.get().google.accounts, ['camille@exemple.be']); ok('jeton d\'actualisation stocké (secret), compte ajouté en minuscules sans doublon');
  await settle(600); await assert.rejects(() => get(redirect + '/?state=' + state), /ECONNREFUSED/); ok('le serveur local est refermé après la connexion');
  // refus de l'utilisateur
  p = start(); await settle(100); const r2u = authUrl.searchParams; const den = await get(r2u.get('redirect_uri') + '/?error=access_denied&state=' + r2u.get('state')); assert(/annulée/.test(den.body)); await assert.rejects(p, /annulée/); ok('refus dans Google (access_denied) : page « annulée » + erreur claire');
  // annulation depuis Jarvis
  p = start(); await settle(100); assert(google.cancel()); await assert.rejects(p, /annulée/); assert.strictEqual(google.cancel(), false); ok('annulation depuis Jarvis : connexion interrompue, serveur fermé');
  // deuxième connexion : annule la première
  p = start(); const p2 = start(); await assert.rejects(p, /annulée/); await settle(100); const u3 = authUrl.searchParams; await get(u3.get('redirect_uri') + '/?code=c2&state=' + u3.get('state')); assert.strictEqual((await p2).email, 'camille@exemple.be'); ok('une nouvelle tentative annule proprement la précédente');
  // scopes partiels
  tokenResp = () => ({ access_token: 'a1', refresh_token: 'rt-2', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.readonly' });
  p = start(); await settle(100); const u4 = authUrl.searchParams; await get(u4.get('redirect_uri') + '/?code=c3&state=' + u4.get('state')); const r4 = await p; assert.deepStrictEqual(r4.missing, ['Gmail']); assert(/Gmail/.test(r4.warning)); ok('autorisation Gmail décochée : avertissement affiché à l\'utilisateur');
  // pas de refresh_token pour un nouveau compte
  handlers.unshift((u) => u.startsWith('https://openidconnect') ? json(200, { email: 'neuf@exemple.be' }) : null); tokenResp = () => ({ access_token: 'a1', expires_in: 3600 });
  p = start(); await settle(100); const u5 = authUrl.searchParams; await get(u5.get('redirect_uri') + '/?code=c4&state=' + u5.get('state')); await assert.rejects(p, /jeton d'accès durable/); assert(!store.settings.get().google.accounts.includes('neuf@exemple.be')); handlers.shift(); ok('réponse sans refresh_token : compte NON ajouté, explication donnée');
  // identifiants invalides
  const savedId = store.settings.get().google.clientId; store.settings.set({ google: { clientId: 'pas-un-id' } }); await assert.rejects(() => google.connect(), /ne ressemble pas/); store.settings.set({ google: { clientId: '' } }); await assert.rejects(() => google.connect(), /Renseigne d'abord/); store.settings.set({ google: { clientId: savedId } }); ok('ID client absent ou mal formé : refus avant d\'ouvrir le navigateur');
  tokenResp = null; handlers.unshift((u) => u.startsWith('https://oauth2.googleapis.com/token') ? json(401, { error: 'invalid_client', error_description: 'Unauthorized' }) : null);
  p = start(); await settle(100); const u6 = authUrl.searchParams; await get(u6.get('redirect_uri') + '/?code=c5&state=' + u6.get('state')); await assert.rejects(p, /Identifiants Google invalides/); handlers.shift(); ok('code secret / ID client refusés par Google : message clair');
  google.setOpener(async () => { throw new Error('pas de navigateur'); }); await assert.rejects(() => google.connect(), /Impossible d'ouvrir le navigateur/); ok('navigateur impossible à ouvrir : erreur claire, serveur refermé');
  // déconnexion
  store.setSecret('google_rt_camille@exemple.be', 'rt-a-revoquer'); store.settings.set({ google: { accounts: ['camille@exemple.be', 'autre@exemple.be'] } });
  assert.strictEqual(await google.disconnect('camille@exemple.be'), true); assert.strictEqual(revoked, 'rt-a-revoquer'); assert.strictEqual(store.getSecret('google_rt_camille@exemple.be'), null); assert.deepStrictEqual(store.settings.get().google.accounts, ['autre@exemple.be']); ok('déconnexion : jeton révoqué chez Google, secret effacé, compte retiré (autres comptes intacts)');
  handlers = []; global.fetch = async () => { throw new TypeError('fetch failed'); }; store.setSecret('google_rt_x@exemple.be', 'zz'); store.settings.set({ google: { accounts: ['x@exemple.be'] } });
  assert.strictEqual(await google.disconnect('x@exemple.be'), true); assert.strictEqual(store.getSecret('google_rt_x@exemple.be'), null); ok('déconnexion hors ligne : effacement local garanti même si la révocation échoue');

  console.log('\nTous les tests Agenda/Google passent ✅'); fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('\n❌ ÉCHEC :', e); process.exit(1); });
function b64uSha(v) { return crypto.createHash('sha256').update(v).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
