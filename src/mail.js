// Courriel : lecture IMAP sans marquer « lu », envoi SMTP d'un .eml uniquement après validation explicite.
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const google = require('./google');
const mt = require('./mailtext');

// Délais explicites : un serveur lent ou muet ne doit jamais bloquer l'application.
const T = { imapConnect: 15000, imapGreeting: 12000, imapSocket: 40000, readDeadline: 60000, testDeadline: 30000, smtpConnect: 15000, smtpGreeting: 15000, smtpSocket: 60000, cacheTtl: 20000 };
const MAX_SOURCE = 400000; // octets lus par message (le texte est presque toujours au début ; les pièces jointes ne sont jamais décodées)

const publicAccount = (a) => ({ id: a.id, label: a.label, email: a.email, imapHost: a.imapHost, imapPort: a.imapPort, smtpHost: a.smtpHost, smtpPort: a.smtpPort, type: 'imap', hasPassword: store.hasSecret('imap_' + a.id) });

function listAccounts() {
  const s = store.settings.get();
  return [
    ...s.mail.accounts.map(publicAccount),
    ...s.google.accounts.map((e) => ({ id: 'google:' + e, label: 'Google · ' + e, email: e, type: 'google' })),
  ];
}

const str = (v) => String(v ?? '').trim();
const HOST_RX = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const portOf = (v, def, name) => { if (v === '' || v == null) return def; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`Port ${name} invalide : « ${v} » (nombre entre 1 et 65535).`); return n; };

function addAccount(a) {
  a = a || {};
  const email = str(a.email);
  if (!email) throw new Error('Champ requis manquant : email');
  if (!mt.validAddress(email)) throw new Error(`Adresse e-mail invalide : « ${email} ».`);
  const host = (v, name) => { const h = str(v).replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, ''); if (!h) throw new Error('Champ requis manquant : ' + name); if (!HOST_RX.test(h)) throw new Error(`Nom de serveur invalide : « ${h} ».`); return h; };
  const imapHost = host(a.imapHost, 'imapHost'), smtpHost = host(a.smtpHost, 'smtpHost');
  const id = 'imap_' + email.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const acc = { id, label: str(a.label).slice(0, 80) || email, email, imapHost, imapPort: portOf(a.imapPort, 993, 'IMAP'), smtpHost, smtpPort: portOf(a.smtpPort, 587, 'SMTP'),
    imapUser: str(a.imapUser) || email, smtpUser: str(a.smtpUser) || str(a.imapUser) || email };
  const s = store.settings.get();
  const previous = s.mail.accounts.find((x) => x.id === id);
  const clean = (p) => (/gmail|googlemail/i.test(imapHost) ? String(p).replace(/\s+/g, '') : String(p)); // les mots de passe d'application Gmail s'affichent par groupes de 4
  if (!a.imapPass && !(previous && store.hasSecret('imap_' + id))) throw new Error('Mot de passe requis pour ajouter le compte.');
  // Le mot de passe d'abord : si le trousseau refuse, aucun compte « sans mot de passe » n'est créé.
  if (a.imapPass) store.setSecret('imap_' + id, clean(a.imapPass));
  if (a.smtpPass || a.imapPass) store.setSecret('smtp_' + id, clean(a.smtpPass || a.imapPass));
  const accounts = [...s.mail.accounts.filter((x) => x.id !== id), acc];
  store.settings.replace({ ...s, mail: { ...s.mail, accounts } });
  invalidate(id);
  return publicAccount(acc);
}

function removeAccount(id) {
  if (String(id).startsWith('google:')) { invalidate(id); return google.disconnect(id.slice(7)); }
  const s = store.settings.get();
  store.settings.replace({ ...s, mail: { ...s.mail, accounts: s.mail.accounts.filter((x) => x.id !== id) } });
  store.setSecret('imap_' + id, null); store.setSecret('smtp_' + id, null);
  invalidate(id);
  return true;
}

const getAcc = (id) => {
  const a = store.settings.get().mail.accounts.find((x) => x.id === id);
  if (!a) throw new Error('Compte introuvable.');
  return a;
};

// ---- Messages d'erreur actionnables ----
function explain(e, { kind = 'IMAP', host = '', port = '', user = '' } = {}) {
  const raw = String(e?.responseText || e?.response || e?.message || e || ''); const code = String(e?.code || '');
  const where = `${host}${port ? ':' + port : ''}`; const gmail = /gmail|googlemail/i.test(host);
  if (e?.userMessage) return e.userMessage;
  if (/IMAP (?:access )?(?:is )?(?:not enabled|disabled)|not enabled for IMAP|IMAP.{0,20}(?:disabled|désactivé)/i.test(raw)) return `L'accès IMAP est désactivé sur ce compte. ${gmail ? 'Dans Gmail : Paramètres → Voir tous les paramètres → Transfert et POP/IMAP → Activer IMAP.' : 'Active IMAP dans les paramètres de ta messagerie.'}`;
  if (e?.authenticationFailed || code === 'EAUTH' || code === 'AUTHENTICATIONFAILED' || /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|\b535\b|LOGIN failed|Username and Password not accepted|Application-specific password|\[AUTH\]|Authentication unsuccessful/i.test(raw)) {
    if (gmail) return 'Gmail refuse la connexion. Il faut un « mot de passe d\'application » (compte Google → Sécurité → Validation en 2 étapes → Mots de passe des applications), et non ton mot de passe habituel. Vérifie aussi que IMAP est activé dans Gmail.';
    if (/outlook|office365|hotmail|live\.com/i.test(host)) return `Microsoft refuse la connexion (${user}). Beaucoup de comptes Outlook/Microsoft 365 n'acceptent plus le mot de passe simple : crée un « mot de passe d'application » ou demande à ton administrateur d'autoriser IMAP/SMTP.`;
    return `Identifiant ou mot de passe refusé par ${where}. Vérifie l'identifiant (${user}) et le mot de passe ; si la validation en deux étapes est active, il faut généralement un « mot de passe d'application ».`;
  }
  if (/certificate|CERT_|SELF_SIGNED|ERR_TLS_CERT|UNABLE_TO_VERIFY/i.test(code + ' ' + raw)) return `Le certificat de sécurité de ${host} n'est pas reconnu. Vérifie le nom du serveur (${kind}) : une faute de frappe ou un serveur mal configuré en est la cause la plus fréquente.`;
  if (/wrong version number|ssl3_get_record|EPROTO|tls handshake|SSL routines|unexpected response/i.test(code + ' ' + raw)) return `La connexion sécurisée avec ${where} échoue : le port ne correspond pas au chiffrement. ${kind === 'IMAP' ? 'IMAP : port 993 (SSL) ou 143 (STARTTLS).' : 'SMTP : port 465 (SSL) ou 587 (STARTTLS).'}`;
  if (['ENOTFOUND', 'EAI_AGAIN', 'EDNS'].includes(code)) return `Serveur ${kind} introuvable (${host}). Vérifie l'adresse du serveur et ta connexion Internet.`;
  if (code === 'ECONNREFUSED') return `Connexion refusée par ${where}. Vérifie le port (${kind === 'IMAP' ? 'IMAP : 993 ou 143' : 'SMTP : 587 ou 465'}) et que le service est ouvert.`;
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ETIMEOUT'].includes(code) || /time(?:d)? ?out|délai/i.test(raw)) return `Le serveur ${where} ne répond pas (délai dépassé). Vérifie le port et ta connexion, ou réessaie dans un instant.`;
  if (['ECONNRESET', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ESOCKET'].includes(code) || /Connection (?:closed|not available)|socket hang up|NoConnection/i.test(raw)) return `La connexion avec ${where} a été interrompue. Vérifie ta connexion Internet puis réessaie.`;
  if (kind === 'SMTP' && (code === 'EENVELOPE' || /^5\d\d\b/.test(String(e?.responseCode || '')))) return `Le serveur d'envoi a refusé le message : ${raw.slice(0, 240)}`;
  return `${kind}${where ? ' (' + where + ')' : ''} : ${raw.slice(0, 300) || 'erreur inconnue'}`;
}
const accCtx = (a, kind) => kind === 'SMTP' ? { kind, host: a.smtpHost, port: a.smtpPort, user: a.smtpUser } : { kind, host: a.imapHost, port: a.imapPort, user: a.imapUser };
const fail = (e, ctx) => { const err = new Error(explain(e, ctx)); err.cause = e; return err; };

function explainGoogle(e) {
  const m = String(e?.message || e);
  if (/non connecté/i.test(m)) return m;
  if (/has not been used|accessNotConfigured|API.*disabled|SERVICE_DISABLED/i.test(m)) return 'L\'API Gmail n\'est pas activée dans ton projet Google Cloud : active « Gmail API » (voir le guide dans l\'onglet Agenda), puis réessaie.';
  if (/invalid_grant|expired or revoked|Invalid Credentials|UNAUTHENTICATED/i.test(m)) return 'La connexion Google a expiré ou a été révoquée : déconnecte puis reconnecte le compte (onglet Agenda).';
  if (/insufficient|scope|PERMISSION_DENIED/i.test(m)) return 'Google n\'a pas accordé la lecture de Gmail : déconnecte puis reconnecte le compte en acceptant l\'accès à Gmail.';
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(m)) return 'Impossible de joindre Google : vérifie ta connexion Internet.';
  return m;
}

// ---- Connexions ----
function imapClient(a) {
  const { ImapFlow } = require('imapflow');
  const pass = store.getSecret('imap_' + a.id);
  if (!pass) { const e = new Error('Mot de passe manquant pour ce compte : retire-le puis ajoute-le de nouveau.'); e.userMessage = e.message; throw e; }
  const secure = a.imapPort === 993;
  const c = new ImapFlow({ host: a.imapHost, port: a.imapPort, secure, doSTARTTLS: secure ? undefined : true, auth: { user: a.imapUser, pass }, logger: false, tls: { rejectUnauthorized: true },
    connectionTimeout: T.imapConnect, greetingTimeout: T.imapGreeting, socketTimeout: T.imapSocket, disableAutoIdle: true });
  c.on('error', () => {}); // une erreur de socket tardive ne doit jamais faire tomber le processus
  return c;
}
const smtpTransport = (a, pass) => require('nodemailer').createTransport({ host: a.smtpHost, port: a.smtpPort, secure: a.smtpPort === 465, requireTLS: a.smtpPort !== 465, auth: { user: a.smtpUser, pass }, connectionTimeout: T.smtpConnect, greetingTimeout: T.smtpGreeting, socketTimeout: T.smtpSocket });

// ---- Lecture ----
const addrText = (field) => (field && field.value ? field.value.flatMap((v) => v.group || [v]).filter((v) => v.address).map((v) => mt.formatAddress({ name: v.name, address: v.address })).join(', ') : '');
const hdrText = (p, k) => { const v = p.headers.get(k); if (v == null) return ''; if (typeof v === 'string') return v; if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x.text || x.id || x.url || '')).join(' '); return v.text || v.value || v.id || v.url || v.mail || ''; };
// mailparser range les en-têtes List-* dans un objet « list » (id, unsubscribe, post…).
const listInfo = (p) => { const l = p.headers.get('list') || {}; const t = (v) => (v ? (typeof v === 'string' ? v : v.id || v.name || v.url || v.mail || v.text || '') : ''); return { id: t(l.id) || t(l.post) || hdrText(p, 'list-id'), unsub: !!(l.unsubscribe || p.headers.has('list-unsubscribe')) }; };
const iso = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toISOString() : ''; };

// mailparser remplace une date illisible par « maintenant » : on relit l'en-tête brut pour ne jamais afficher une fausse date.
const rawDate = (src) => { const m = /^Date:[ \t]*(.+(?:\r?\n[ \t]+.+)*)/im.exec(String(src.slice(0, 8000))); if (!m) return null; const t = new Date(m[1].replace(/\r?\n[ \t]+/g, ' ').replace(/\s*\(.*\)\s*$/, '')); return isNaN(t) ? '' : t.toISOString(); };

async function parseOne(msg, accId, maxLen) {
  const { simpleParser } = require('mailparser');
  const p = await simpleParser(msg.source);
  const atts = (p.attachments || []).filter((x) => !x.related || x.contentDisposition === 'attachment');
  const info = atts.map((x) => ({ name: x.filename || 'pièce jointe', size: x.size || 0, type: x.contentType || '' }));
  return mt.normalize({ id: String(msg.uid), account: accId, from: addrText(p.from) || p.from?.text || '', replyTo: addrText(p.replyTo), to: addrText(p.to), cc: addrText(p.cc), subject: p.subject || '(sans objet)',
    date: (() => { const d = rawDate(msg.source); return d === null ? iso(p.date) : d; })(), received: iso(msg.internalDate), unread: !msg.flags.has('\\Seen'), flagged: msg.flags.has('\\Flagged'),
    text: p.text || '', html: typeof p.html === 'string' ? p.html : '', messageId: p.messageId || '', references: Array.isArray(p.references) ? p.references.join(' ') : (p.references || ''),
    listId: listInfo(p).id, listUnsubscribe: listInfo(p).unsub, bulk: /bulk|list|junk/i.test(hdrText(p, 'precedence')) || /auto-(generated|replied)/i.test(hdrText(p, 'auto-submitted')), attachments: info.map((x) => x.name), attachmentInfo: info, sourceTruncated: !!(msg.size && msg.size > maxLen) });
}

async function readImap(a, id, limit) {
  const c = imapClient(a); const out = []; let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { c.close(); } catch { /* déjà fermé */ } }, T.readDeadline);
  try {
    await c.connect();
    const lock = await c.getMailboxLock('INBOX', { readOnly: true }); // lecture seule : ne marque rien comme lu
    try {
      const total = c.mailbox.exists; if (!total) return [];
      const from = Math.max(1, total - limit + 1);
      for await (const msg of c.fetch(`${from}:*`, { uid: true, flags: true, internalDate: true, size: true, source: { maxLength: MAX_SOURCE } })) {
        try { out.push(await parseOne(msg, id, MAX_SOURCE)); }
        catch (e) { out.push(mt.normalize({ id: String(msg.uid), account: id, from: '', subject: '(message illisible)', date: '', received: iso(msg.internalDate), unread: !msg.flags.has('\\Seen'), text: 'Ce message n\'a pas pu être décodé (' + String(e.message).slice(0, 80) + ').', html: '' })); }
      }
    } finally { lock.release(); }
  } catch (e) {
    if (timedOut) { const err = new Error(`Le serveur ${a.imapHost} met trop de temps à répondre (plus de ${T.readDeadline / 1000} s). Réessaie dans un instant ou réduis le nombre de messages.`); err.cause = e; throw err; }
    throw fail(e, accCtx(a, 'IMAP'));
  } finally { clearTimeout(timer); await c.logout().catch(() => { try { c.close(); } catch { /* ignoré */ } }); }
  return mt.sortMails(out);
}

// Cache court (évite de relire pour rien : « Lire » puis « Résumer », retour sur la page…) + partage des lectures simultanées.
const cache = new Map(); const inflight = new Map();
function invalidate(id) { if (!id) return cache.clear(); for (const k of [...cache.keys()]) if (k.startsWith(id + '|')) cache.delete(k); }

// `limit` : nombre (1–50) ou { n, force } pour contourner le cache (bouton « Actualiser »).
async function read(id, limit = 10) {
  const opt = limit && typeof limit === 'object' ? limit : { n: limit };
  const n = Math.min(Math.max(Math.floor(Number(opt.n)) || 10, 1), 50); id = String(id);
  const key = `${id}|${n}`; const hit = cache.get(key);
  if (!opt.force && hit && Date.now() - hit.t < T.cacheTtl) return hit.data.map((m) => ({ ...m }));
  if (!opt.force && inflight.has(key)) return (await inflight.get(key)).map((m) => ({ ...m }));
  const job = (async () => {
    if (id.startsWith('google:')) { try { return mt.sortMails(await google.gmailRead(id.slice(7), n)); } catch (e) { throw new Error(explainGoogle(e)); } }
    return readImap(getAcc(id), id, n);
  })();
  inflight.set(key, job);
  try { const data = await job; cache.set(key, { t: Date.now(), data }); if (cache.size > 40) cache.delete(cache.keys().next().value); return data.map((m) => ({ ...m })); }
  finally { inflight.delete(key); }
}

// Plusieurs comptes en parallèle : une panne n'empêche pas les autres de s'afficher.
async function readMany(ids, limit = 10) {
  const res = await Promise.allSettled(ids.map((id) => read(id, limit)));
  const messages = [], errors = [];
  res.forEach((r, i) => { if (r.status === 'fulfilled') messages.push(...r.value); else errors.push({ account: ids[i], error: r.reason?.message || String(r.reason) }); });
  return { messages: mt.sortMails(messages), errors };
}

async function testAccount(id) {
  if (String(id).startsWith('google:')) { const m = await read(id, { n: 1, force: true }); return { ok: true, detail: `Gmail OK (${m.length} message lu)` }; }
  const a = getAcc(id); let n = 0, unread = 0;
  const c = imapClient(a); const timer = setTimeout(() => { try { c.close(); } catch { /* ignoré */ } }, T.testDeadline);
  try {
    await c.connect();
    const lock = await c.getMailboxLock('INBOX', { readOnly: true });
    try { n = c.mailbox.exists || 0; if (n) { const u = await c.search({ seen: false }); unread = Array.isArray(u) ? u.length : 0; } } finally { lock.release(); }
  } catch (e) { throw fail(e, accCtx(a, 'IMAP')); }
  finally { clearTimeout(timer); await c.logout().catch(() => { try { c.close(); } catch { /* ignoré */ } }); }
  const imapOk = `IMAP OK (${n} message${n > 1 ? 's' : ''}, ${unread} non lu${unread > 1 ? 's' : ''})`;
  const spass = store.getSecret('smtp_' + id);
  if (!spass) return { ok: true, detail: `${imapOk}. Mot de passe d'envoi absent : l'envoi ne fonctionnera pas.`, n, unread };
  const t = smtpTransport(a, spass);
  try { await t.verify(); } catch (e) { throw new Error(`${imapOk}, mais l'envoi (SMTP) échoue. ${explain(e, accCtx(a, 'SMTP'))}`); } finally { t.close(); }
  return { ok: true, detail: `${imapOk} et SMTP OK`, n, unread };
}

// ---- Envoi ----
const SINGLE = ['from', 'to', 'cc', 'bcc', 'subject', 'date', 'message-id', 'reply-to', 'sender', 'in-reply-to'];

// Liste d'adresses → texte d'en-tête sûr (noms encodés, aucune fin de ligne). Lève une erreur claire si une adresse est invalide.
function headerAddrs(label, input, { required = false } = {}) {
  const { valid, invalid } = mt.parseAddresses(String(input || ''));
  if (invalid.length) throw new Error(`Adresse invalide dans « ${label} » : « ${invalid[0].slice(0, 80)} ». Vérifie l'orthographe (une adresse par destinataire, séparées par des virgules).`);
  if (required && !valid.length) throw new Error(`Aucun destinataire (${label}).`);
  return valid.map((v) => mt.formatAddress(v, true)).join(', ');
}
const idList = (s, max) => (String(s || '').match(/<[^<>\s]{1,300}>/g) || []).slice(-max).join(' ');

function buildEml({ from, to, cc, bcc, subject, body, inReplyTo, references }) {
  const f = mt.parseAddresses(String(from || '')).valid[0];
  if (!f) throw new Error('Adresse d\'expéditeur invalide.');
  const domain = (f.address.split('@')[1] || 'jarvis.local').replace(/[^A-Za-z0-9.-]/g, '') || 'jarvis.local';
  const irt = idList(inReplyTo, 1), refs = idList(references, 20);
  const toH = headerAddrs('À', to), ccH = headerAddrs('Cc', cc), bccH = headerAddrs('Bcc', bcc);
  return [`From: ${mt.formatAddress(f, true)}`, toH ? `To: ${toH}` : null, ccH ? `Cc: ${ccH}` : null, bccH ? `Bcc: ${bccH}` : null, `Subject: ${mt.encodeWord(subject || '')}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`, irt ? `In-Reply-To: ${irt}` : null, refs ? `References: ${refs}` : null, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', mt.qpEncode(body || '')]
    .filter((x) => x !== null).join('\r\n');
}

// Prépare l'envoi : renvoie ce qui sera réellement envoyé (pour la boîte de validation).
function prepareSend(id, raw) {
  if (String(id).startsWith('google:')) throw new Error('Les comptes Google sont en lecture seule. Ajoute un compte SMTP pour envoyer.');
  raw = String(raw || '');
  const a = getAcc(id); const eml = mt.parseEml(raw);
  for (const k of SINGLE) if ((eml.headers[k] || []).length > 1) throw new Error(`L'en-tête « ${k} » apparaît deux fois : message refusé par prudence.`);
  if (Object.keys(eml.headers).some((k) => k.startsWith('resent-'))) throw new Error('En-têtes Resent-* refusés.');
  const h = (k) => (eml.headers[k] || [''])[0];
  const froms = mt.parseAddresses(h('from')); const from = froms.valid[0]?.address;
  if (!from || froms.valid.length !== 1 || froms.invalid.length) throw new Error('En-tête From manquant ou invalide.');
  if (from.toLowerCase() !== a.email.toLowerCase()) throw new Error(`Le From (${from}) ne correspond pas au compte choisi (${a.email}).`);
  if (h('sender') && mt.addrOf(h('sender')).toLowerCase() !== a.email.toLowerCase()) throw new Error('En-tête Sender différent du compte : message refusé.');
  const list = (label, key, required) => {
    const { valid, invalid } = mt.parseAddresses(h(key));
    if (invalid.length) throw new Error(`Adresse invalide dans « ${label} » : « ${invalid[0].slice(0, 80)} ».`);
    if (required && !valid.length) throw new Error('Aucun destinataire (To).');
    return valid.map((v) => v.address);
  };
  const to = list('To', 'to', true), cc = list('Cc', 'cc'), bcc = list('Bcc', 'bcc');
  if (to.length + cc.length + bcc.length > 100) throw new Error('Plus de 100 destinataires : message refusé par prudence.');
  return { account: a.email, from, to, cc, bcc, subject: mt.decodeWords(h('subject')), preview: eml.body.slice(0, 1500), raw };
}

// Retire l'en-tête Bcc (et ses lignes de continuation) des seuls en-têtes ; le corps n'est jamais touché.
function stripBcc(raw) {
  const m = /\r?\n\r?\n/.exec(raw); const head = m ? raw.slice(0, m.index) : raw; const rest = m ? raw.slice(m.index) : '';
  const kept = []; let skipping = false;
  for (const l of head.split(/\r?\n/)) { if (/^[ \t]/.test(l)) { if (!skipping) kept.push(l); continue; } skipping = /^bcc\s*:/i.test(l); if (!skipping) kept.push(l); }
  return kept.join('\r\n') + rest;
}

async function send(id, raw, confirmToken, expectedToken) {
  if (!confirmToken || confirmToken !== expectedToken) throw new Error('Envoi non confirmé.');
  const prep = prepareSend(id, raw); const a = getAcc(id);
  const pass = store.getSecret('smtp_' + id);
  if (!pass) throw new Error('Mot de passe d\'envoi manquant : retire le compte puis ajoute-le de nouveau.');
  const t = smtpTransport(a, pass);
  let info;
  try { info = await t.sendMail({ envelope: { from: prep.from, to: [...prep.to, ...prep.cc, ...prep.bcc] }, raw: stripBcc(raw) }); }
  catch (e) { throw fail(e, accCtx(a, 'SMTP')); }
  finally { t.close(); }
  const mid = mt.parseEml(raw).headers['message-id']?.[0] || info.messageId;
  const log = store.read('sent', { items: [] });
  log.items.unshift({ t: store.now(), account: a.email, to: prep.to, subject: prep.subject, messageId: mid }); log.items = log.items.slice(0, 200);
  store.write('sent', log);
  return { accepted: info.accepted, rejected: info.rejected, messageId: mid };
}

function readEmlFile(p) {
  if (fs.statSync(p).size > 20 * 1024 * 1024) throw new Error('Fichier trop volumineux (plus de 20 Mo).');
  return fs.readFileSync(p, 'utf8');
}

// Préremplissage d'une réponse : destinataire, objet, citation, compte d'envoi conseillé.
function replyPrefill(m) {
  const accs = listAccounts().filter((a) => a.type === 'imap');
  const own = accs.find((a) => a.id === m.account || a.email === m.account) || accs.find((a) => String(m.to || '').toLowerCase().includes(a.email.toLowerCase())) || accs[0];
  return { ...mt.replyPrefill(m, listAccounts().map((a) => a.email)), sendAccount: own?.id || '', canSend: accs.length > 0, ownEmail: own?.email || '' };
}

module.exports = { replyPrefill, listAccounts, addAccount, removeAccount, read, readMany, testAccount, buildEml, prepareSend, send, readEmlFile, explain, _stripBcc: stripBcc, _T: T, _invalidate: invalidate };
