// Courriel : lecture IMAP sans marquer « lu », envoi SMTP d'un .eml uniquement après validation explicite.
const fs = require('fs');
const store = require('./store');
const google = require('./google');
const mt = require('./mailtext');

const publicAccount = (a) => ({ id: a.id, label: a.label, email: a.email, imapHost: a.imapHost, imapPort: a.imapPort, smtpHost: a.smtpHost, smtpPort: a.smtpPort, type: 'imap' });

function listAccounts() {
  const s = store.settings.get();
  return [
    ...s.mail.accounts.map(publicAccount),
    ...s.google.accounts.map((e) => ({ id: 'google:' + e, label: 'Google · ' + e, email: e, type: 'google' })),
  ];
}

function addAccount(a) {
  for (const k of ['email', 'imapHost', 'smtpHost']) if (!a[k]) throw new Error('Champ requis manquant : ' + k);
  const id = 'imap_' + a.email.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const acc = { id, label: a.label || a.email, email: a.email.trim(), imapHost: a.imapHost.trim(), imapPort: Number(a.imapPort) || 993, smtpHost: a.smtpHost.trim(), smtpPort: Number(a.smtpPort) || 587,
    imapUser: (a.imapUser || a.email).trim(), smtpUser: (a.smtpUser || a.imapUser || a.email).trim() };
  const s = store.settings.get();
  const accounts = [...s.mail.accounts.filter((x) => x.id !== id), acc];
  store.settings.replace({ ...s, mail: { ...s.mail, accounts } });
  if (a.imapPass) store.setSecret('imap_' + id, a.imapPass);
  if (a.smtpPass || a.imapPass) store.setSecret('smtp_' + id, a.smtpPass || a.imapPass);
  return publicAccount(acc);
}

function removeAccount(id) {
  if (id.startsWith('google:')) return google.disconnect(id.slice(7));
  const s = store.settings.get();
  store.settings.replace({ ...s, mail: { ...s.mail, accounts: s.mail.accounts.filter((x) => x.id !== id) } });
  store.setSecret('imap_' + id, null); store.setSecret('smtp_' + id, null);
  return true;
}

const getAcc = (id) => {
  const a = store.settings.get().mail.accounts.find((x) => x.id === id);
  if (!a) throw new Error('Compte introuvable.');
  return a;
};

async function imapClient(a) {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow({ host: a.imapHost, port: a.imapPort, secure: a.imapPort === 993, auth: { user: a.imapUser, pass: store.getSecret('imap_' + a.id) || '' }, logger: false, tls: { rejectUnauthorized: true } });
}

async function read(id, limit = 10) {
  limit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  if (id.startsWith('google:')) return google.gmailRead(id.slice(7), limit);
  const a = getAcc(id); const { simpleParser } = require('mailparser');
  const c = await imapClient(a); const out = [];
  await c.connect();
  try {
    const lock = await c.getMailboxLock('INBOX', { readOnly: true }); // lecture seule : ne marque rien comme lu
    try {
      const total = c.mailbox.exists; if (!total) return [];
      const from = Math.max(1, total - limit + 1);
      for await (const msg of c.fetch(`${from}:*`, { uid: true, flags: true, source: { maxLength: 400000 } })) {
        const p = await simpleParser(msg.source);
        out.push(mt.normalize({ id: String(msg.uid), account: id, from: p.from?.text || '', replyTo: p.replyTo?.text || '', to: p.to?.text || '', subject: p.subject || '(sans objet)', date: p.date ? p.date.toISOString() : '', unread: !msg.flags.has('\\Seen'),
          text: p.text || '', html: typeof p.html === 'string' ? p.html : '', messageId: p.messageId || '', references: Array.isArray(p.references) ? p.references.join(' ') : (p.references || ''), attachments: (p.attachments || []).map((x) => x.filename).filter(Boolean) }));
      }
    } finally { lock.release(); }
  } finally { await c.logout().catch(() => {}); }
  return out.reverse();
}

async function testAccount(id) {
  if (id.startsWith('google:')) { const m = await google.gmailRead(id.slice(7), 1); return { ok: true, detail: `Gmail OK (${m.length} message lu)` }; }
  const a = getAcc(id); const c = await imapClient(a);
  await c.connect(); const n = c.mailbox ? 0 : 0; await c.logout().catch(() => {});
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: a.smtpHost, port: a.smtpPort, secure: a.smtpPort === 465, auth: { user: a.smtpUser, pass: store.getSecret('smtp_' + id) || '' } });
  await t.verify();
  return { ok: true, detail: 'IMAP et SMTP OK', n };
}

// ---- Envoi ----
function parseEmlHeaders(raw) {
  const head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  const h = {}; for (const l of head.split(/\r?\n/)) { const i = l.indexOf(':'); if (i > 0) h[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
  return h;
}
const addrs = (s) => (s || '').split(',').map((x) => (x.match(/<([^>]+)>/) || [null, x])[1].trim()).filter((x) => /.+@.+/.test(x));

function buildEml({ from, to, cc, bcc, subject, body, inReplyTo, references }) {
  const enc = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=');
  return [`From: ${from}`, `To: ${to}`, cc ? `Cc: ${cc}` : null, bcc ? `Bcc: ${bcc}` : null, `Subject: ${enc(subject || '')}`, `Date: ${new Date().toUTCString()}`, inReplyTo ? `In-Reply-To: ${String(inReplyTo).replace(/[\r\n]/g, '')}` : null, references ? `References: ${String(references).replace(/[\r\n]/g, '')}` : null, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', body || ''].filter((x) => x !== null).join('\r\n');
}

// Prépare l'envoi : renvoie ce qui sera réellement envoyé (pour la boîte de validation).
function prepareSend(id, raw) {
  if (id.startsWith('google:')) throw new Error('Les comptes Google sont en lecture seule. Ajoute un compte SMTP pour envoyer.');
  const a = getAcc(id); const h = parseEmlHeaders(raw);
  const from = addrs(h.from)[0];
  if (!from) throw new Error('En-tête From manquant ou invalide.');
  if (from.toLowerCase() !== a.email.toLowerCase()) throw new Error(`Le From (${from}) ne correspond pas au compte choisi (${a.email}).`);
  const to = addrs(h.to), cc = addrs(h.cc), bcc = addrs(h.bcc);
  if (!to.length) throw new Error('Aucun destinataire (To).');
  if (Object.keys(h).some((k) => k.startsWith('resent-'))) throw new Error('En-têtes Resent-* refusés.');
  const body = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n');
  return { account: a.email, from, to, cc, bcc, subject: h.subject || '', preview: body.slice(0, 1500), raw };
}

async function send(id, raw, confirmToken, expectedToken) {
  if (!confirmToken || confirmToken !== expectedToken) throw new Error('Envoi non confirmé.');
  const prep = prepareSend(id, raw); const a = getAcc(id);
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: a.smtpHost, port: a.smtpPort, secure: a.smtpPort === 465, requireTLS: a.smtpPort !== 465, auth: { user: a.smtpUser, pass: store.getSecret('smtp_' + id) || '' } });
  const clean = raw.replace(/^bcc:.*(\r?\n[ \t].*)*\r?\n/gim, ''); // Bcc retiré des en-têtes, conservé dans l'enveloppe
  const info = await t.sendMail({ envelope: { from: prep.from, to: [...prep.to, ...prep.cc, ...prep.bcc] }, raw: clean });
  const log = store.read('sent', { items: [] });
  log.items.unshift({ t: store.now(), account: a.email, to: prep.to, subject: prep.subject, messageId: info.messageId }); log.items = log.items.slice(0, 200);
  store.write('sent', log);
  return { accepted: info.accepted, rejected: info.rejected, messageId: info.messageId };
}

function readEmlFile(p) { return fs.readFileSync(p, 'utf8'); }

// Préremplissage d'une réponse : destinataire, objet, citation, compte d'envoi conseillé.
function replyPrefill(m) {
  const accs = listAccounts().filter((a) => a.type === 'imap');
  const own = accs.find((a) => a.id === m.account) || accs[0];
  return { ...mt.replyPrefill(m, own?.email), sendAccount: own?.id || '', canSend: accs.length > 0 };
}

module.exports = { replyPrefill, listAccounts, addAccount, removeAccount, read, testAccount, buildEml, prepareSend, send, readEmlFile };
