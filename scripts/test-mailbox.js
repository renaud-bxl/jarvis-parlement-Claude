// Tests de la boîte mail intelligente : dates, règles, classement par l'IA (simulée), événements, ICS, consentement cloud. Lancer : node scripts/test-mailbox.js
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mb-'));
process.env.JARVIS_DATA_DIR = path.join(tmp, 'data'); process.env.JARVIS_DOCS_DIR = path.join(tmp, 'docs'); process.env.JARVIS_INSECURE_SECRETS = '1';
const ok = (m) => console.log('  ✓', m);
let aiCalls = 0; let aiMode = 'good';
global.fetch = async (_url, opts) => {
  const body = JSON.parse(opts.body); const prompt = String(body.messages?.[0]?.content || ''); aiCalls++;
  if (aiMode === 'fail') return { ok: false, status: 500, text: async () => '{"error":{"message":"boom"}}' };
  const n = (prompt.match(/### Message \d+/g) || []).length; const items = [];
  for (let i = 0; i < n; i++) {
    const blk = (prompt.split(`### Message ${i}\n`)[1] || '').split('### Message')[0];
    if (/Séance plénière/.test(blk)) items.push({ i, category: 'event', importance: 2, needsReaction: true, deadline: '2026-10-30', reason: 'Confirmer la présence avant le 30/10', summary: 'Invitation à la séance plénière', event: { title: 'Séance plénière', start: '2026-11-03T14:00', end: '2026-11-03T16:30', location: 'Parlement bruxellois', confidence: 0.9 } });
    else if (/Newsletter/.test(blk)) items.push({ i, category: 'promo', importance: 1, needsReaction: true, reason: 'x', summary: 'Newsletter', event: { title: 'Webinaire promo', start: '2026-11-05T10:00', confidence: 0.9 } });
    else if (/budget/.test(blk)) items.push({ i, category: 'reaction', importance: 3, needsReaction: true, deadline: null, reason: 'Question sur le budget', summary: 'Marie demande le budget 2027', event: null });
    else items.push({ i, category: 'info', importance: 1, needsReaction: false, summary: 'Information', event: { title: 'Piège', start: '2019-01-01T10:00', confidence: 1 } });
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ items }) }], stop_reason: 'end_turn' }) };
};
const store = require('../src/store'); const llm = require('../src/llm'); const mail = require('../src/mail');
const mb = require('../src/mailbox'); const ics = require('../src/ics');
const NOW = new Date('2026-10-27T10:00:00Z');
(async () => {
  // ---- Dates françaises ----
  const d1 = mb.findDates('La séance aura lieu le mardi 3 novembre 2026 de 14h à 16h30 au Parlement. Merci de répondre avant le 28/10/2026.', NOW);
  assert(d1.some((d) => d.date === '2026-11-03' && d.start === '14:00' && d.end === '16:30') && d1.some((d) => d.date === '2026-10-28')); ok('dates : « mardi 3 novembre 2026 de 14h à 16h30 » et « avant le 28/10/2026 »');
  assert.strictEqual(mb.findDates('Rendez-vous le 1er décembre à 9h', NOW)[0].date, '2026-12-01'); assert.strictEqual(mb.findDates('Rendez-vous le 15 janvier à 18:30', NOW)[0].date, '2027-01-15'); ok('année absente : prochaine occurrence (1er décembre, 15 janvier → 2027)');
  assert.deepStrictEqual(mb.findDates('Publié le 3 mars 2019. Version du 31/02/2026.', NOW), []); ok('dates passées ou inexistantes ignorées');
  // ---- Règles ----
  const msg = (o) => ({ account: 'a', id: String(Math.random()).slice(2), unread: true, date: '2026-10-27T08:00:00.000Z', text: '', attachments: [], ...o });
  const news = msg({ from: 'Newsletter <news@x.be>', subject: 'Newsletter d\'octobre', text: 'Découvrez nos offres. Se désinscrire', listUnsubscribe: true });
  const ask = msg({ from: 'Marie <marie@x.be>', subject: 'Question sur le budget', text: 'Bonjour, pourriez-vous me confirmer le budget voté avant le 30 octobre ? Merci.' });
  const evt = msg({ from: 'Greffe <greffe@parlement.brussels>', subject: 'Invitation : Séance plénière', text: 'Vous êtes convié à la séance plénière le 3 novembre 2026 à 14h00 au Parlement bruxellois. Merci de confirmer votre présence avant le 30 octobre 2026.' });
  const info = msg({ from: 'Paul <paul@x.be>', subject: 'Compte rendu', text: 'Voici le compte rendu de la réunion de la semaine dernière, pour information.' });
  assert(mb.heuristics(news, NOW).bulk && !mb.heuristics(news, NOW).reaction); assert(mb.heuristics(ask, NOW).reaction && mb.heuristics(ask, NOW).deadline === '2026-10-30'); assert(!mb.heuristics(info, NOW).reaction);
  ok('règles : newsletter ≠ réaction ; « pourriez-vous… avant le 30 octobre » = réaction avec échéance');
  const re = mb.fromRules(evt, mb.heuristics(evt, NOW), NOW); assert(re.categories.includes('event') && re.event.start === '2026-11-03T14:00' && re.event.title); assert(mb.fromRules(news, mb.heuristics(news, NOW), NOW).categories[0] === 'promo'); ok('règles seules : événement détecté (jour + heure), newsletter classée en promotions');
  // ---- Classement par l'IA (simulée) ----
  store.setSecret('anthropic_key', 'sk-test'); assert(llm.configured() && !llm.isLocal());
  store.settings.set({ mail: { accounts: [] } });
  const acc = { id: 'imap_a', label: 'Parlement', email: 'moi@x.be', type: 'imap' };
  mail.listAccounts = () => [acc]; let readCalls = 0; mail.readMany = async () => { readCalls++; return { messages: [{ ...news, account: 'imap_a' }, { ...ask, account: 'imap_a' }, { ...evt, account: 'imap_a' }, { ...info, account: 'imap_a' }, { ...msg({ from: 'x', subject: 'Lu', text: 'déjà lu' }), unread: false, account: 'imap_a' }], errors: [] }; };
  let r = await mb.triage({}, NOW);
  assert(r.consentNeeded && aiCalls === 0 && r.total === 4); ok('moteur cloud sans accord : AUCUN appel à l\'IA, classement par règles + invitation à autoriser');
  assert(!Object.values(r.items).some((i) => i.subject === 'Lu')); ok('seuls les courriels NON LUS sont analysés');
  r = await mb.triage({ allowCloud: true, force: true }, NOW);
  const by = Object.fromEntries(Object.values(r.items).map((i) => [i.subject, i])); aiCalls = aiCalls;
  assert(r.aiUsed && by['Invitation : Séance plénière'].categories.includes('event') && by['Invitation : Séance plénière'].categories.includes('reaction') && by['Invitation : Séance plénière'].event.start === '2026-11-03T14:00'); ok('IA : l\'invitation est à la fois « événement » (avec date) et « attente de réaction »');
  assert(by['Question sur le budget'].category === 'reaction' && by['Question sur le budget'].importance === 3); ok('IA : question importante qui attend une réponse → attente de réaction');
  assert(by['Newsletter d\'octobre'].category === 'promo' && !by['Newsletter d\'octobre'].event && !by['Newsletter d\'octobre'].needsReaction); ok('garde-fou : une newsletter ne devient ni événement ni réaction, même si l\'IA le propose');
  assert(by['Compte rendu'].event === null && by['Compte rendu'].category === 'info'); ok('garde-fou : événement dans le passé (2019) refusé');
  assert(r.groups.reaction.length === 2 && r.groups.event.length === 1 && r.groups.promo.length === 1 && r.counts.important >= 1); ok('groupes : réaction, événements, importants, à lire, promotions');
  const calls = aiCalls; r = await mb.triage({ allowCloud: true }, NOW); assert.strictEqual(aiCalls, calls); ok('cache : un courriel déjà classé n\'est pas renvoyé à l\'IA');
  // ---- Panne de l'IA : repli sur les règles ----
  aiMode = 'fail'; const db0 = store.read('mailbox', { items: {} }); store.write('mailbox', { items: {} });
  r = await mb.triage({ allowCloud: true, force: true }, NOW); assert(r.total === 4 && r.notes.length && !r.aiUsed && Object.values(r.items).every((i) => i.source === 'règles')); ok('panne du moteur IA : repli sur les règles, aucune perte, message d\'avertissement');
  aiMode = 'good'; store.write('mailbox', { items: {} });
  // ---- Statuts ----
  r = await mb.triage({ allowCloud: true, force: true }, NOW); const keyAsk = Object.values(r.items).find((i) => i.subject === 'Question sur le budget').key;
  mb.setStatus({ key: keyAsk, status: 'done' }); r = await mb.triage({ allowCloud: true }, NOW); assert(!r.items[keyAsk] && r.total === 3); assert.throws(() => mb.setStatus({ key: keyAsk, status: 'nimportequoi' }), /Statut/); ok('« Traité » : le courriel disparaît de la liste (local, sans toucher à la boîte)');
  // ---- Agenda ----
  const keyEv = Object.values(r.items).find((i) => i.event).key; const ev = mb.eventOf(keyEv);
  const url = ics.googleUrl(ev); assert(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE') && /dates=20261103T140000%2F20261103T163000/.test(url) && /ctz=Europe%2FBrussels/.test(url)); ok('Google Agenda : lien pré-rempli (jour, heures, fuseau Bruxelles, lieu)');
  const text = ics.toIcs(ev, { uidSeed: keyEv }); assert(/DTSTART:20261103T130000Z/.test(text) && /DTEND:20261103T153000Z/.test(text) && /SUMMARY:Séance plénière/.test(text) && text.endsWith('\r\n') && text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)); ok('.ics : 14h00 Bruxelles = 13:00 UTC en novembre, lignes ≤ 75 octets, CRLF');
  assert(/DTSTART:20260701T120000Z/.test(ics.toIcs({ title: 'Été', start: '2026-07-01T14:00' }))); ok('.ics : heure d\'été (14h00 → 12:00 UTC)');
  const allDay = ics.toIcs({ title: 'Congé', start: '2026-12-24', end: '2026-12-25' }); assert(/DTSTART;VALUE=DATE:20261224/.test(allDay) && /DTEND;VALUE=DATE:20261226/.test(allDay)); ok('.ics : journée entière, fin exclusive');
  assert.throws(() => ics.toIcs({ title: '', start: '2026-11-03T10:00' }), /titre/); assert.throws(() => ics.toIcs({ title: 'x', start: '2026-02-31' }), /existe pas/); assert.throws(() => ics.googleUrl({ title: 'x', start: 'demain' }), /invalide/); ok('événement invalide refusé (titre, date inexistante, format)');
  const evInj = ics.toIcs({ title: 'A\r\nBEGIN:VEVENT\r\nSUMMARY:pirate', start: '2026-11-03T10:00', description: 'x;y,z\nligne' }); assert(!/\r\nBEGIN:VEVENT\r\nSUMMARY:pirate/.test(evInj) && evInj.split('\r\n').filter((l) => l.startsWith('BEGIN:VEVENT')).length === 1 && evInj.split('\r\n').filter((l) => l.startsWith('SUMMARY:')).length === 1); ok('.ics : injection de lignes dans le titre neutralisée');
  // ---- Voix : « check mes mails » = boîte intelligente, avec consentement cloud ----
  const jv = require('../src/jarvis'); store.write('mailbox', { items: {} }); store.settings.set({ jarvis: { cloudMailOk: false } });
  let res = await jv.command({ text: 'check mes mails' }); assert(res.confirm && /oui, non/.test(res.say)); ok('Jarvis : moteur cloud → demande d\'abord l\'accord avant d\'envoyer les courriels');
  const callsBefore = aiCalls; res = await jv.command({ text: 'non', pending: res.confirm }); assert(res.triage && !res.triage.aiUsed && aiCalls === callsBefore && /nouveaux? mails?/.test(res.say)); ok('Jarvis : refus → tri simple local, AUCUN envoi à l\'IA');
  store.write('mailbox', { items: {} }); res = await jv.command({ text: 'oui', pending: { intent: 'mails', args: {} } }); assert(res.triage.aiUsed && /attend/.test(res.say) && /événement/.test(res.say) && /Le plus important/.test(res.say) && res.say.split(/\s+/).length < 90); ok('Jarvis : résumé parlé court — « 2 attendent votre réaction ; 1 contient un événement… Le plus important : … »');
  console.log('\nTous les tests de la boîte intelligente passent ✅'); fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('\n❌ ÉCHEC :', e); process.exit(1); });
