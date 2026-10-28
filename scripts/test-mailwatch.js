// Tests de la surveillance des courriels, des alertes de suivi, des expéditeurs urgents et du centre d'alertes.
// Autonome : node scripts/test-mailwatch.js   (données temporaires, aucun réseau : fetch, mail.listAccounts/readMany et le client IMAP sont simulés)
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const vm = require('vm');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mw-'));
process.env.JARVIS_DATA_DIR = path.join(tmp, 'data'); process.env.JARVIS_DOCS_DIR = path.join(tmp, 'docs'); process.env.JARVIS_INSECURE_SECRETS = '1';
const ok = (m) => console.log('  ✓', m);
const ROOT = path.join(__dirname, '..');

// ---- Moteur IA simulé (compte les appels : le consentement cloud doit les empêcher) ----
let aiCalls = 0;
global.fetch = async (_url, opts) => {
  const body = JSON.parse(opts.body); const prompt = String(body.messages?.[0]?.content || ''); aiCalls++;
  const n = (prompt.match(/### Message \d+/g) || []).length; const items = [];
  for (let i = 0; i < n; i++) items.push({ i, category: 'promo', importance: 1, needsReaction: false, summary: 'Résumé IA', event: null }); // l'IA voudrait tout rétrograder en newsletter
  return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ items }) }], stop_reason: 'end_turn' }) };
};
const store = require('../src/store'); const llm = require('../src/llm'); const mail = require('../src/mail');
const mb = require('../src/mailbox'); const watch = require('../src/mailwatch');
const realList = mail.listAccounts; const realRead = mail.readMany;
const NOW = new Date('2026-10-27T10:00:00Z');
const at = (min) => new Date(NOW.getTime() + min * 60000);
const iso = (d) => d.toISOString();
let seq = 0;
const M = (o = {}) => { const id = String(++seq); return { account: 'imap_a', id, messageId: `<m${id}@x.be>`, unread: true, date: iso(at(-5)), from: 'Paul <paul@x.be>', subject: 'Sujet ' + id, text: 'Voici une information pour vous.', attachments: [], ...o }; };
const settingsMail = () => store.settings.get().mail;

(async () => {
  // =====================================================================================================
  // 0. Lecture seule : garde-fou statique sur le code de surveillance et sur les droits Gmail
  // =====================================================================================================
  const FORBID = /messageDelete|messageMove|messageCopy|messageFlags(?:Add|Remove|Set)|setFlags|\.append\(|\.expunge|mailbox(?:Create|Delete|Rename)|\\Seen|\\Deleted|sendMail|messages\/[^'"`]*(?:trash|modify|delete|send)|gmail\.(?:modify|send|compose)/i;
  for (const f of ['src/mailwatch.js', 'src/mailbox.js']) assert(!FORBID.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} contient une opération d'écriture sur la boîte`);
  const g = fs.readFileSync(path.join(ROOT, 'src/google.js'), 'utf8');
  assert(/gmail\.readonly/.test(g) && !/gmail\.(modify|send|compose)|mail\.google\.com\//.test(g.replace(/gmail\.googleapis\.com/g, ''))); ok('lecture seule : aucune opération d’écriture dans la surveillance ; Gmail limité au droit « gmail.readonly »');

  // =====================================================================================================
  // 1. Plan de notification (pur) : regroupement, aperçu, urgence
  // =====================================================================================================
  const E = (k, o = {}) => ({ key: k, from: 'Marie', subject: 'Budget ' + k, strong: false, reason: '', ...o });
  let p = watch.plan([E('a')], { notifyPreview: true });
  assert(p.native.title === 'Marie' && p.native.body === 'Budget a' && p.native.key === 'a' && !p.native.urgent && p.inapp.length === 1 && !p.inapp[0].urgent && p.inapp[0].detail === 'Budget a');
  p = watch.plan([E('a'), E('b'), E('c')], {});
  assert(p.native.title === '3 nouveaux courriels' && p.inapp.length === 1 && p.inapp[0].title === '3 nouveaux courriels' && p.inapp[0].keys.length === 3 && p.inapp[0].count === 3);
  p = watch.plan([E('a', { subject: 'Secret défense' })], { notifyPreview: false });
  assert(!/Secret/.test(JSON.stringify(p)) && p.native.body === 'Nouveau courriel');
  p = watch.plan([E('a'), E('b', { strong: true, reason: 'Expéditeur urgent' })], {});
  assert(p.native.title === '2 nouveaux courriels dont 1 urgent' && p.native.urgent && p.inapp.some((x) => x.urgent && x.key === 'b' && x.tag === 'Expéditeur urgent') && p.inapp.some((x) => !x.urgent && x.key === 'a'));
  p = watch.plan(['a', 'b', 'c', 'd', 'e'].map((k) => E(k, { strong: true })), {}); assert(p.inapp.length === 4 && p.inapp[3].count === 2 && p.inapp.every((x) => x.urgent));
  ok('notifications : 1 courriel = expéditeur + objet ; plusieurs = « 3 nouveaux courriels » ; aperçu désactivable ; urgents signalés plus fort');

  // =====================================================================================================
  // 2. Surveillance : base de référence, nouveaux, regroupement, doublons
  // =====================================================================================================
  store.settings.set({ mail: { accounts: [] }, ai: { provider: 'anthropic' } });
  const accA = { id: 'imap_a', label: 'Parlement', email: 'moi@x.be', type: 'imap' }; const accB = { id: 'imap_b', label: 'Perso', email: 'moi@y.be', type: 'imap' };
  let accounts = [accA]; const boxes = { imap_a: [], imap_b: [] }; const fail = {}; let readCalls = []; let gate = null;
  mail.listAccounts = () => accounts;
  mail.readMany = async (ids, limit) => {
    readCalls.push({ ids: ids.slice(), limit }); if (gate) await gate.promise;
    const messages = [], errors = [];
    for (const id of ids) { if (fail[id]) errors.push({ account: id, error: fail[id] }); else messages.push(...boxes[id].map((m) => ({ ...m }))); }
    if (fail.__throw) throw new Error(fail.__throw);
    return { messages, errors };
  };
  const events = []; const natives = []; const timers = []; let cleared = 0;
  const deps = { emit: (c, d) => events.push([c, d]), notify: (n) => natives.push(n), setTimer: (f, ms) => { const t = { f, ms, unref() {} }; timers.push(t); return t; }, clearTimer: () => { cleared++; }, clock: () => NOW };
  const alertsOf = () => events.filter((e) => e[0] === 'mail-alert').map((e) => e[1]);
  const reset = () => { events.length = 0; natives.length = 0; readCalls = []; };

  watch.start({ ...deps, firstDelay: 10000 });
  assert(timers.length === 1 && timers[0].ms === 10000); ok('démarrage : premier passage planifié peu après l’ouverture');
  boxes.imap_a = [M({ date: iso(at(-60 * 24 * 3)), subject: 'Ancien 1' }), M({ date: iso(at(-60 * 24 * 2)), subject: 'Ancien 2' }), M({ unread: false, subject: 'Lu' })];
  let r = await watch.runOnce({ now: NOW });
  assert(r.ok && r.accounts[0].baseline && alertsOf().length === 0 && natives.length === 0); ok('premier passage : base de référence, AUCUNE notification de l’historique');
  assert(readCalls.length === 1 && readCalls[0].limit && readCalls[0].limit.force === true && readCalls[0].limit.n <= 40); ok('lecture bornée (≤ 40 messages) et sans cache périmé');
  const h0 = mb.history({}); assert(h0.total === 2 && h0.items.every((i) => i.source === 'règles')); ok('les non lus de la base de référence sont déjà classés (boîte intelligente instantanée)');
  reset(); r = await watch.runOnce({ now: at(3) }); assert(alertsOf().length === 0 && natives.length === 0 && r.fresh === 0); ok('passage suivant sans nouveauté : aucune alerte');

  const n1 = M({ from: 'Marie Dupont <marie@x.be>', subject: 'Réunion de jeudi', date: iso(at(5)) }); boxes.imap_a.push(n1);
  reset(); r = await watch.runOnce({ now: at(6) });
  assert(r.fresh === 1 && natives.length === 1 && natives[0].title === 'Marie Dupont' && natives[0].body === 'Réunion de jeudi' && natives[0].key === mb.keyOf(n1) && !natives[0].urgent); ok('nouveau courriel : notification native (expéditeur + objet) avec clé pour le clic');
  const a1 = alertsOf(); assert(a1.length === 1 && a1[0].kind === 'mail' && a1[0].key === mb.keyOf(n1) && !a1[0].urgent && a1[0].title === 'Marie Dupont'); ok('… et alerte dans l’application (ordinaire, non persistante)');
  assert(events.some((e) => e[0] === 'mail-alerts')); ok('compteur d’alertes de suivi diffusé à l’interface');
  reset(); await watch.runOnce({ now: at(9) }); assert(alertsOf().length === 0 && natives.length === 0); ok('pas de doublon au passage suivant');
  const hist1 = mb.history({}); assert(hist1.items.some((i) => i.key === mb.keyOf(n1) && i.source === 'règles')); ok('le nouveau courriel est classé et enregistré dans le cache');

  boxes.imap_a.push(M({ subject: 'Un', date: iso(at(10)) }), M({ subject: 'Deux', date: iso(at(10)) }), M({ subject: 'Trois', date: iso(at(10)) }));
  reset(); r = await watch.runOnce({ now: at(12) });
  assert(r.fresh === 3 && natives.length === 1 && natives[0].title === '3 nouveaux courriels' && alertsOf().length === 1 && alertsOf()[0].title === '3 nouveaux courriels' && alertsOf()[0].count === 3); ok('plusieurs nouveaux courriels en un passage : « 3 nouveaux courriels » (une seule notification)');

  boxes.imap_a.push(M({ subject: 'Confidentiel budget', date: iso(at(13)) })); store.settings.set({ mail: { notifyPreview: false } });
  reset(); await watch.runOnce({ now: at(15) }); assert(natives.length === 1 && !/budget/i.test(JSON.stringify([natives, alertsOf()])) && natives[0].body === 'Nouveau courriel'); store.settings.set({ mail: { notifyPreview: true } }); ok('notifyPreview = false : l’objet n’apparaît ni dans la notification ni dans l’alerte');

  boxes.imap_a.push(M({ unread: false, subject: 'Déjà lu ailleurs', date: iso(at(16)) }), M({ subject: 'Très ancien non lu', date: iso(at(-60 * 24 * 40)) }));
  reset(); r = await watch.runOnce({ now: at(18) }); assert(r.fresh === 0 && natives.length === 0 && alertsOf().length === 0); assert(mb.history({ q: 'Très ancien' }).total === 1); ok('un message déjà lu, ou un vieux non lu réapparu dans la fenêtre, ne déclenche pas de notification (mais est classé)');

  // Expéditeur urgent / importance 3 : alerte persistante
  mb.vipAdd({ pattern: 'president@parlement.brussels', label: 'Président' });
  const vipMsg = M({ from: 'Le Président <president@parlement.brussels>', subject: 'Bonjour', date: iso(at(19)) }); boxes.imap_a.push(vipMsg);
  reset(); await watch.runOnce({ now: at(20) });
  assert(natives.length === 1 && natives[0].urgent && /urgent/i.test(natives[0].title) && alertsOf()[0].urgent === true && alertsOf()[0].tag === 'Expéditeur urgent'); ok('expéditeur urgent : notification « Courriel urgent » et alerte persistante');
  boxes.imap_a.push(M({ subject: 'URGENT : réponse avant midi', date: iso(at(21)) }));
  reset(); await watch.runOnce({ now: at(22) }); assert(alertsOf()[0].urgent === true && alertsOf()[0].tag === 'Très important'); ok('courriel très important : alerte persistante');
  boxes.imap_a.push(M({ subject: 'Dépôt du dossier', text: 'Le dossier doit être déposé avant le 29 octobre 2026.', date: iso(at(23)) }));
  reset(); await watch.runOnce({ now: at(24) }); assert(alertsOf()[0].urgent === true && /Échéance dans 2 jours/.test(alertsOf()[0].tag)); ok('courriel avec échéance proche : alerte persistante (« Échéance dans 2 jours »)');

  // =====================================================================================================
  // 3. Plusieurs comptes, pannes, backoff, une seule alerte d'erreur
  // =====================================================================================================
  accounts = [accA, accB]; boxes.imap_b = [M({ account: 'imap_b', subject: 'Historique B', date: iso(at(-100)) })];
  reset(); await watch.runOnce({ now: at(30) }); assert(alertsOf().length === 0 && natives.length === 0); ok('nouveau compte ajouté : sa propre base de référence (son historique n’est pas notifié)');
  fail.imap_b = 'Connexion refusée par imap.y.be.'; boxes.imap_a.push(M({ subject: 'Pour A pendant la panne de B', date: iso(at(31)) }));
  reset(); r = await watch.runOnce({ now: at(33) });
  assert(r.accounts.find((a) => a.id === 'imap_b').ok === false && r.accounts.find((a) => a.id === 'imap_a').fresh === 1); assert(natives.some((n) => n.body === 'Pour A pendant la panne de B')); ok('un compte en panne n’empêche pas la lecture de l’autre');
  const errs = () => alertsOf().filter((a) => a.id === 'mail-error:imap_b');
  assert(errs().length === 1 && errs()[0].kind === 'error' && /Perso/.test(errs()[0].title) && /Tester/.test(errs()[0].detail) && /Connexion refusée/.test(errs()[0].detail)); ok('panne : message actionnable (compte, cause, « Tester » dans Courriels)');
  readCalls = []; reset(); await watch.runOnce({ now: at(36) }); assert(!readCalls.some((c) => c.ids.includes('imap_b')) && readCalls.some((c) => c.ids.includes('imap_a'))); ok('backoff : le compte en panne est mis de côté (2× l’intervalle), l’autre continue');
  reset(); await watch.runOnce({ now: at(39.5) }); assert(readCalls.some((c) => c.ids.includes('imap_b')) && errs().length === 0); ok('… puis réessayé à l’échéance, sans nouvelle alerte d’erreur tant que la panne persiste');
  readCalls = []; await watch.runOnce({ now: at(45) }); assert(!readCalls.some((c) => c.ids.includes('imap_b'))); await watch.runOnce({ now: at(40 + 12.5) }); assert(readCalls.some((c) => c.ids.includes('imap_b'))); ok('backoff exponentiel : 6 min, puis 12 min…');
  const st = watch.status(); assert(st.accounts.find((a) => a.id === 'imap_b').fails === 3 && /Connexion refusée/.test(st.accounts.find((a) => a.id === 'imap_b').error)); ok('état exposé : échecs consécutifs et dernière erreur');
  fail.imap_b = null; reset(); await watch.runOnce({ now: at(40 + 12.5 + 30) }); assert(alertsOf().some((a) => a.id === 'mail-ok:imap_b')); ok('retour à la normale signalé une fois');
  fail.imap_b = 'Délai dépassé.'; reset(); await watch.runOnce({ now: at(200) }); assert(errs().length === 1); ok('une nouvelle panne, après rétablissement, est de nouveau signalée (une fois)');
  reset(); fail.imap_b = null; fail.__throw = 'getaddrinfo ENOTFOUND imap.x.be'; readCalls = [];
  r = await watch.runOnce({ now: at(300) }); assert(r.ok === true && r.accounts.every((a) => a.ok === false)); delete fail.__throw; ok('réseau coupé (exception) : aucun plantage, erreurs signalées par compte');

  // Pas de chevauchement
  watch.__test.reset(); fail.__throw = undefined; accounts = [accA]; readCalls = []; let release; gate = { promise: new Promise((res) => { release = res; }) };
  const run1 = watch.runOnce({ now: at(400) }); const run2 = await watch.runOnce({ now: at(400) });
  assert(run2.skipped === 'busy'); release(); gate = null; await run1; assert(readCalls.length === 1); ok('pas de chevauchement : un passage en cours bloque le suivant');

  // Désactivation
  store.settings.set({ mail: { watch: false } }); readCalls = [];
  r = await watch.runOnce({ now: at(410) }); assert(r.skipped === 'disabled' && readCalls.length === 0);
  r = await watch.runOnce({ now: at(410), manual: true }); assert(readCalls.length === 1); store.settings.set({ mail: { watch: true } }); ok('surveillance désactivable ; « Vérifier maintenant » fonctionne quand même');

  // Planification, pause, réveil, arrêt
  timers.length = 0; await timers[0]; store.settings.set({ mail: { watchMinutes: 7 } }); watch.reschedule(); assert(timers[timers.length - 1].ms === 7 * 60000); store.settings.set({ mail: { watchMinutes: 3 } });
  watch.reschedule(); assert(timers[timers.length - 1].ms === 180000); ok('intervalle réglable (watchMinutes) : 3 minutes par défaut, 7 si réglé');
  const t = timers[timers.length - 1]; readCalls = []; await t.f(); assert(readCalls.length >= 1 && timers[timers.length - 1].ms === 180000 && timers[timers.length - 1] !== t); ok('le minuteur lance un passage puis se replanifie');
  const c0 = cleared; watch.pause(); assert(cleared > c0); const nT = timers.length; watch.resume(); assert(timers.length === nT + 1 && timers[timers.length - 1].ms === 8000); ok('mise en veille : pause ; réveil : rattrapage dans les secondes qui suivent');
  fail.imap_a = 'Réseau pas encore revenu'; reset(); await watch.runOnce({ now: at(0.5) }); assert(alertsOf().filter((a) => a.kind === 'error').length === 0); delete fail.imap_a; ok('juste après un réveil, une erreur réseau n’affiche pas d’alerte');
  watch.__test.reset(); gate = { promise: new Promise((res) => { release = res; }) }; boxes.imap_a.push(M({ subject: 'Arrivé pendant l’arrêt', date: iso(at(500)) })); reset();
  const run3 = watch.runOnce({ now: at(501) }); watch.stop(); release(); gate = null; r = await run3; assert(r.cancelled === true && alertsOf().length === 0 && natives.length === 0); ok('arrêt propre : le passage en cours est annulé sans rien émettre');
  const nT2 = timers.length; watch.reschedule(); assert(timers.length === nT2); ok('après l’arrêt, plus aucun minuteur');

  // =====================================================================================================
  // 4. Consentement cloud : aucun appel IA sans accord
  // =====================================================================================================
  store.setSecret('anthropic_key', 'sk-test'); assert(llm.configured() && !llm.isLocal()); store.settings.set({ jarvis: { cloudMailOk: false } });
  watch.start({ ...deps, firstDelay: 10 }); watch.__test.reset(); aiCalls = 0; reset();
  boxes.imap_a.push(M({ subject: 'Question budget', text: 'Pourriez-vous me confirmer le budget ?', date: iso(at(600)) }));
  await watch.runOnce({ now: at(601) }); assert(aiCalls === 0 && natives.length === 1); ok('moteur cloud sans accord : AUCUN appel à l’IA (règles seules), notification quand même');
  store.settings.set({ jarvis: { cloudMailOk: true } }); boxes.imap_a.push(M({ subject: 'Autre question', text: 'Pourriez-vous me confirmer ?', date: iso(at(602)) })); reset();
  await watch.runOnce({ now: at(603) }); assert(aiCalls >= 1 && natives.length === 1); ok('avec l’accord : le classement est amélioré par l’IA après la notification');
  store.settings.set({ jarvis: { cloudMailOk: false } });
  const warm = mb.history({}).items.find((i) => i.subject === 'Autre question'); assert(warm && warm.source === 'ia'); ok('… et l’amélioration est enregistrée dans le cache');

  // =====================================================================================================
  // 5. Expéditeurs urgents
  // =====================================================================================================
  mb.vipRemove({ pattern: 'president@parlement.brussels' }); store.settings.set({ mail: { vip: [] } });
  const mm = (from, o = {}) => M({ from, subject: 'Hello', date: iso(at(-10)), ...o });
  const heur = (m) => mb.heuristics(m, NOW).vip;
  mb.vipAdd({ pattern: ' Marie@Exemple.BE ', label: 'Marie' });
  assert(mb.vipList()[0].pattern === 'marie@exemple.be'); assert(heur(mm('Marie D <MARIE@exemple.be>')) && !heur(mm('Autre <autre@exemple.be>'))); ok('urgent par adresse (normalisée en minuscules, insensible à la casse)');
  mb.vipAdd({ pattern: '@parlement.brussels' });
  assert(heur(mm('X <n.importe.qui@parlement.brussels>')) && heur(mm('y@sous.parlement.brussels')) && !heur(mm('y@evil-parlement.brussels')) && !heur(mm('y@parlement.brussels.evil.com')) && !heur(mm('y@xparlement.brussels'))); ok('urgent par domaine (sous-domaines inclus, domaines voisins ou piégés exclus)');
  assert(!heur(mm('"marie@exemple.be" <spam@evil.com>')) && !heur(mm('marie@exemple.be.evil.com'))  && !heur(mm('')) && !heur(mm('pas une adresse'))); ok('un nom affiché qui imite une adresse urgente ne passe pas');
  // classement : jamais newsletter, jamais rétrogradé
  const newsVip = mm('Cabinet <noreply@parlement.brussels>', { subject: 'Newsletter d’octobre', text: 'Se désinscrire', listUnsubscribe: true });
  const cls = mb.fromRules(newsVip, mb.heuristics(newsVip, NOW), NOW); assert(cls.categories[0] === 'urgent' && !cls.categories.includes('promo') && cls.importance === 3 && cls.vip);
  const ai = mb.mergeAi({ category: 'promo', importance: 1, needsReaction: false, summary: 'x' }, newsVip, mb.heuristics(newsVip, NOW), NOW); assert(ai.categories[0] === 'urgent' && !ai.categories.includes('promo') && ai.importance === 3 && ai.vip); ok('un expéditeur urgent est classé « urgent », importance 3, jamais en newsletter, jamais rétrogradé par l’IA');
  // rétroactif
  store.write('mailbox', { items: {} }); const late = mm('Greffe <greffe@autre.be>', { subject: 'Info courante', text: 'Pour information.' });
  await mb.ingest([late], { now: NOW }); let it = mb.history({}).items[0]; assert(it.category === 'info' && !it.vip);
  const res = mb.vipAdd({ pattern: 'greffe@autre.be' }); assert(res.reclassified === 1); it = mb.history({}).items[0]; assert(it.category === 'urgent' && it.importance === 3 && it.vip && it.categories[0] === 'urgent' && mb.alerts({ now: NOW }).items.some((a) => a.key === it.key && a.level === 'vip')); ok('rétroactif : les courriels non traités déjà classés passent en « urgent » tout de suite (sans IA)');
  mb.vipRemove({ pattern: 'greffe@autre.be' }); it = mb.history({}).items[0]; assert(it.category === 'info' && !it.vip && !mb.alerts({ now: NOW }).items.length); ok('retrait d’un urgent : le classement d’origine est restauré');
  const kk = it.key; mb.setStatus({ key: kk, status: 'done' }); mb.vipAdd({ pattern: 'greffe@autre.be' }); assert(mb.history({}).items[0].category === 'info'); mb.vipRemove({ pattern: 'greffe@autre.be' }); ok('les courriels déjà traités ne sont pas reclassés');
  // ajout depuis une carte (clé + portée)
  store.write('mailbox', { items: {} }); const c2 = mm('Jean <jean@ministere.be>', { subject: 'Dossier', text: 'Bonjour' }); await mb.ingest([c2], { now: NOW });
  const key2 = mb.keyOf(c2); mb.vipAdd({ key: key2, scope: 'domain', label: 'Ministère' }); assert(mb.vipList().some((e) => e.pattern === '@ministere.be' && e.label === 'Ministère') && mb.history({}).items[0].vip); ok('« Toujours urgent » depuis une carte : cette adresse ou tout le domaine');
  assert.throws(() => mb.vipAdd({ key: key2, scope: 'domain' }) && mb.vipAdd({ pattern: '@gmail.com' }), /public/); assert.throws(() => mb.vipAdd({ pattern: '@sub.outlook.com' }), /public/); ok('un fournisseur de messagerie public ne peut pas être ajouté comme « domaine »');

  // =====================================================================================================
  // 6. Validation des entrées (API)
  // =====================================================================================================
  const apiMod = require('../src/api'); const api = apiMod.create({ dialog: {}, shell: {}, app: {}, systemPreferences: {}, getWindow: () => null, emit() {} });
  store.settings.set({ mail: { vip: [] } });
  const bad = [undefined, null, 42, {}, [], true, '', '   ', '*@x.be', '@@x.be', 'a@b@c.be', '@x', '@be', 'x@.be', '.x@x.be', 'x.@x.be', 'a..b@x.be', '<script>@x.be', 'a b@x.be', 'é@x.be', 'a@xé.be', 'a@x_y.be', 'x'.repeat(300) + '@x.be', 'a@' + 'b'.repeat(70) + '.be', 'marie@exemple.be\nBcc: x@y.be', 'marie@exemple.be\u0000', '"marie"@x.be', 'javascript:alert(1)', 'http://x.be', '../../etc/passwd', '__proto__', '{"$ne":1}', 'a@b.c'.repeat(80)];
  for (const b of bad) await assert.rejects(async () => api['mailbox.vip.add']({ pattern: b }), /./, 'devrait refuser : ' + JSON.stringify(b)); assert.deepStrictEqual(mb.vipList(), []);
  await assert.rejects(async () => api['mailbox.vip.add']({ key: 'abc', scope: 'tout' }), /domaine|adresse/i); await assert.rejects(async () => api['mailbox.vip.add']({ key: '../x', scope: 'address' }), /invalide/i); await assert.rejects(async () => api['mailbox.vip.remove']({ pattern: 'jamais@vu.be' }), /liste/); await assert.rejects(async () => api['mailbox.vip.remove']({}), /./);
  const added = await api['mailbox.vip.add']({ pattern: ' Paul.Durand+vip@Exemple.be ', label: 'Paul\u0007 <b>x</b>\u2028\n' + 'z'.repeat(150) }); assert(added.vip[0].pattern === 'paul.durand+vip@exemple.be' && !/[\u0007<>\u2028\n]/.test(added.vip[0].label) && added.vip[0].label.length <= 80); ok('entrées VIP hostiles ou invalides refusées (33 cas) ; adresse et libellé normalisés');
  await api['mailbox.vip.add']({ pattern: 'paul.durand+vip@exemple.be', label: 'Nouveau nom' }); assert(mb.vipList().length === 1 && mb.vipList()[0].label === 'Nouveau nom'); ok('un doublon met à jour le nom au lieu d’ajouter une ligne');
  for (let i = 1; i < 200; i++) mb.vipAdd({ pattern: `u${i}@exemple.be` }); assert(mb.vipList().length === 200); await assert.rejects(async () => api['mailbox.vip.add']({ pattern: 'trop@exemple.be' }), /Limite de 200/); ok('limite de 200 expéditeurs urgents');
  store.settings.set({ mail: { vip: [{ pattern: 'ok@x.be', label: 'ok' }, { pattern: '*@evil', label: 'x' }, 'texte', null, { pattern: 42 }] } }); assert.deepStrictEqual(mb.vipList().map((e) => e.pattern), ['ok@x.be']); store.settings.set({ mail: { vip: [] } }); ok('liste corrompue dans les réglages : entrées invalides ignorées');
  const san = apiMod.sanitizeSettingsPatch({ mail: { vip: [{ pattern: 'pirate@x.be' }], accounts: [{ id: 'x' }], watch: 0, watchMinutes: 9999, followDays: -5, notifyPreview: 'oui', briefingIncludesMail: 1 } });
  assert(!('vip' in san.mail) && !('accounts' in san.mail) && san.mail.watch === false && san.mail.watchMinutes === 60 && san.mail.followDays === 1 && san.mail.notifyPreview === true && san.mail.briefingIncludesMail === true); assert(Object.keys(apiMod.sanitizeSettingsPatch({ mail: { watchMinutes: 'abc' } })).length === 0); ok('réglages : watch, watchMinutes (1–60), notifyPreview, followDays acceptés et bornés ; vip et comptes refusés');
  const d = store.settings.get().mail; assert(d.watch === true && d.watchMinutes === 3 && d.notifyPreview === true && d.followDays === 7 && Array.isArray(d.vip)); ok('valeurs par défaut : surveillance active, 3 minutes, aperçu, 7 jours');
  for (const a of [{ category: 'nimporte' }, { status: 'x' }, { from: '2026-13' }, { to: 'demain' }, { limit: 0 }, { limit: 500 }, { offset: -1 }, { account: '../x' }, { q: 'x'.repeat(300) }, { q: 5 }]) await assert.rejects(async () => api['mailbox.history'](a), /./, JSON.stringify(a));
  await assert.rejects(async () => api['mailbox.snooze']({ key: 'abc', days: 0 }), /Durée/); await assert.rejects(async () => api['mailbox.snooze']({ key: 'abc', days: 99 }), /Durée/); await assert.rejects(async () => api['mailbox.snooze']({ key: 'abc', days: 'x' }), /Durée/); await assert.rejects(async () => api['mailbox.snooze']({ key: 'abc', days: 1.5 }), /Durée/);
  await assert.rejects(async () => api['mailbox.watch.configure']({ watchMinutes: 0 }), /Fréquence/); await assert.rejects(async () => api['mailbox.watch.configure']({ followDays: 99 }), /Délai/);
  const cfgRes = await api['mailbox.watch.configure']({ watchMinutes: 5, followDays: 10, notifyPreview: false, watch: true }); assert(cfgRes.minutes === 5 && settingsMail().followDays === 10 && settingsMail().notifyPreview === false); await api['mailbox.watch.configure']({ watchMinutes: 3, followDays: 7, notifyPreview: true }); ok('historique, rappel (snooze) et réglages de surveillance : arguments validés');

  // =====================================================================================================
  // 7. Alerte suivi : règles
  // =====================================================================================================
  store.write('mailbox', { items: {} }); store.settings.set({ mail: { vip: [{ pattern: 'vip@x.be', label: 'Chef' }], followDays: 7 } });
  const fresh = iso(at(-60));
  const mk = (subject, text, o = {}) => M({ subject, text, date: fresh, from: 'Exp <exp@x.be>', ...o });
  const set = {
    late: mk('Dossier A', 'Le rapport doit être remis avant le 26 octobre 2026.'),
    today: mk('Dossier B', 'Le rapport doit être remis avant le 27 octobre 2026.'),
    soon: mk('Dossier C', 'Le rapport doit être remis avant le 29 octobre 2026.'),
    edge7: mk('Dossier D', 'Le rapport doit être remis avant le 3 novembre 2026.'),
    far: mk('Dossier E', 'Le rapport doit être remis avant le 4 novembre 2026.'),
    vip: mk('Bonjour', 'Un simple mot.', { from: 'Chef <vip@x.be>' }),
    imp3: mk('URGENT : appel', 'Merci de me rappeler.'),
    silent: mk('Votre avis', 'Pourriez-vous me confirmer votre accord ? Merci.', { date: iso(at(-60 * 24 * 3)) }),
    fresh: mk('Votre avis frais', 'Pourriez-vous me confirmer votre accord ? Merci.', { date: iso(at(-60 * 47)) }),
    info: mk('Compte rendu', 'Voici le compte rendu pour information.'),
    news: mk('Newsletter', 'Offre valable avant le 28 octobre 2026. Se désinscrire', { from: 'News <news@x.be>', listUnsubscribe: true }),
  };
  await mb.ingest(Object.values(set), { now: NOW });
  const K = Object.fromEntries(Object.entries(set).map(([k, m]) => [k, mb.keyOf(m)])); const A = mb.alerts({ now: NOW }); const by = (k) => A.items.find((a) => a.key === K[k]);
  assert(by('late') && by('late').level === 'overdue' && by('late').reason === 'Échéance dépassée depuis 1 jour'); assert(by('today') && by('today').level === 'today' && by('today').reason === "Échéance aujourd'hui");
  assert(by('soon') && by('soon').level === 'soon' && by('soon').reason === 'Échéance dans 2 jours'); assert(by('edge7') && by('edge7').reason === 'Échéance dans 7 jours' && by('edge7').daysLeft === 7); assert(!by('far')); ok('échéances : en retard, aujourd’hui, dans 2 jours, dans 7 jours ; au-delà de 7 jours : pas d’alerte');
  assert(by('vip') && by('vip').level === 'vip' && by('vip').reason === 'Expéditeur urgent' && by('vip').vipLabel === 'Chef'); assert(by('imp3') && by('imp3').level === 'important' && by('imp3').reason === 'Très important'); ok('expéditeur urgent et courriel très important');
  assert(by('silent') && by('silent').level === 'silent' && by('silent').reason === 'Sans réponse depuis 3 jours' && !by('fresh')); ok('« attente de réaction » sans réponse depuis plus de 48 h (3 jours → alerte ; 47 h → pas encore)');
  assert(!by('info') && !by('news')); ok('un courriel courant ou une newsletter (même avec une date limite) ne déclenche pas d’alerte');
  const order = A.items.map((a) => a.level); const rank = ['overdue', 'today', 'soon', 'vip', 'important', 'silent'];
  assert(order.every((l, i) => i === 0 || rank.indexOf(order[i - 1]) <= rank.indexOf(l))); assert(A.count === A.items.length && A.urgent === A.items.filter((a) => ['overdue', 'today', 'soon', 'vip'].includes(a.level)).length && mb.alertCount({ now: NOW }).count === A.count); ok('tri par urgence (en retard > aujourd’hui > bientôt > VIP > très important > sans réponse) ; compteurs cohérents');
  // lu ou non, tant que non traité
  const rd = { ...set.late, unread: false }; await mb.ingest([rd], { now: NOW }); assert(mb.alerts({ now: NOW }).items.some((a) => a.key === K.late && a.unread === false)); ok('un courriel lu reste en alerte tant qu’il n’est pas « Traité »');
  // followDays réglable
  store.settings.set({ mail: { followDays: 3 } }); assert(!mb.alerts({ now: NOW }).items.some((a) => a.key === K.edge7) && mb.alerts({ now: NOW }).items.some((a) => a.key === K.soon)); store.settings.set({ mail: { followDays: 7 } }); ok('délai de suivi réglable (followDays)');
  // snooze
  mb.snooze({ key: K.today, days: 1 }, NOW); assert(!mb.alerts({ now: NOW }).items.some((a) => a.key === K.today) && !mb.alerts({ now: at(60 * 23) }).items.some((a) => a.key === K.today)); assert(mb.alerts({ now: at(60 * 25) }).items.some((a) => a.key === K.today)); ok('« Rappeler plus tard » (1 jour) : l’alerte disparaît puis revient');
  mb.snooze({ key: K.late, days: 7 }, NOW); assert(!mb.alerts({ now: at(60 * 24 * 6) }).items.some((a) => a.key === K.late) && mb.alerts({ now: at(60 * 24 * 8) }).items.some((a) => a.key === K.late)); assert.throws(() => mb.snooze({ key: K.late, days: 0 }), /Choisissez/); assert.throws(() => mb.snooze({ key: 'inconnu', days: 1 }), /introuvable/); ok('rappel dans 1 semaine ; durée et courriel inconnus refusés');
  // traité / ignoré
  mb.setStatus({ key: K.soon, status: 'done' }); mb.setStatus({ key: K.vip, status: 'ignored' }); const A2 = mb.alerts({ now: NOW }); assert(!A2.items.some((a) => a.key === K.soon || a.key === K.vip)); mb.setStatus({ key: K.soon, status: 'new' }); assert(mb.alerts({ now: NOW }).items.some((a) => a.key === K.soon)); ok('« Traité » et « ignoré » retirent l’alerte (et « remettre à traiter » la rétablit)');
  mb.setStatus({ key: K.edge7, status: 'later' }); assert(mb.alerts({ now: NOW }).items.some((a) => a.key === K.edge7)); ok('« à relancer plus tard » reste en alerte');
  const v = mb.alertsView({ now: NOW }); assert(v.alertsOnly && v.alerts.count === v.total && Object.values(v.items).every((x) => x.message && x.message.subject)); ok('vue « alertes » pour l’écran Jarvis : mêmes cartes, avec le message pour Répondre / Lire');

  // Jarvis : action « alertes » et accueil
  const jv = require('../src/jarvis');
  for (const phrase of ['y a-t-il des alertes ?', 'mes alertes de suivi', "qu'est-ce qui est urgent ?", 'est-ce que j’ai des alertes', 'Jarvis, quelles sont mes alertes ?']) assert(jv.fastRoute(phrase, {})?.intent === 'alertes' || (await jv.route(phrase, {}))?.intent === 'alertes', 'routage : ' + phrase);
  const out = await jv.command({ text: 'mes alertes de suivi' });
  assert(/alerte/.test(out.say) && /Le plus pressant/.test(out.say) && out.say.split(/\s+/).length < 80 && out.triage && out.triage.alertsOnly && aiCalls >= 0); ok('Jarvis : « mes alertes de suivi » → résumé parlé court + cartes à l’écran');
  const gr = jv.greeting(); assert(gr.alerts.count > 0 && /alerte/.test(gr.offer)); ok('l’accueil de Jarvis mentionne le nombre d’alertes de suivi');
  const calls0 = aiCalls; await jv.command({ text: 'y a-t-il des alertes ?' }); assert.strictEqual(aiCalls, calls0); ok('« alertes » est local : rien n’est envoyé à l’IA');
  store.write('mailbox', { items: {} }); assert(!/alerte/.test(jv.greeting().offer) && /Aucune alerte/.test((await jv.command({ text: 'mes alertes' })).say)); ok('sans alerte : l’accueil n’en parle pas ; « mes alertes » répond que tout est à jour');

  // =====================================================================================================
  // 8. Historique local classé (borné, filtres)
  // =====================================================================================================
  store.write('mailbox', { items: {} });
  const mkh = (n, o = {}) => M({ subject: `Msg ${n}`, text: n % 2 ? 'Rapport sur le budget de la mobilité.' : 'Invitation à la séance plénière.', date: iso(at(-60 * 24 * (n % 20))), account: n % 3 ? 'imap_a' : 'imap_b', from: `P${n} <p${n}@x.be>`, ...o });
  await mb.ingest(Array.from({ length: 120 }, (_, i) => mkh(i)), { now: NOW });
  let H = mb.history({ limit: 50 }); assert(H.total === 120 && H.items.length === 50 && H.items[0].date >= H.items[49].date); assert(mb.history({ offset: 100, limit: 50 }).items.length === 20); ok('historique : tri par date, pagination');
  assert(mb.history({ q: 'séance plénière' }).total === 60 && mb.history({ q: 'SEANCE plenière' }).total === 60 && mb.history({ q: 'p77@x' }).total === 1); ok('recherche texte (insensible à la casse et aux accents : objet, expéditeur, extrait)');
  assert(mb.history({ account: 'imap_b' }).total === 40 && mb.history({ account: 'imap_a', q: 'budget' }).items.every((i) => i.account === 'imap_a')); ok('filtre par compte');
  const day = (n) => mb.__test.dayBru(at(-60 * 24 * n)); const rng = mb.history({ from: day(5), to: day(2) }); assert(rng.total > 0 && rng.items.every((i) => { const d = mb.__test.dayBru(i.date); return d >= day(5) && d <= day(2); })); ok('filtre par plage de dates (jours de Bruxelles)');
  H = mb.history({}); assert(H.counts.important > 0 && H.counts.urgent === 0 && mb.history({ category: 'important' }).total === H.counts.important && mb.history({ category: 'important' }).items.every((i) => i.categories.includes('important'))); ok('dossiers virtuels = catégories, avec comptage');
  mb.setStatus({ key: H.items[0].key, status: 'done' }); assert(mb.history({ status: 'done' }).total === 1 && mb.history({ status: 'open' }).total === 119 && mb.history({ status: 'all' }).total === 120); ok('le courriel traité reste retrouvable dans l’historique');
  // borne
  const CAP = mb.__test.CACHE_MAX; const bigDb = { items: {} }; for (let i = 0; i < CAP + 80; i++) bigDb.items['k' + i] = { cls: { categories: ['info'], importance: 1 }, at: new Date(2026, 0, 1, 0, 0, i % 59, i).toISOString(), status: i < 30 ? 'done' : 'new', meta: { subject: 's', from: 'a@b.be', account: 'imap_a', date: '' } };
  mb.__test.saveDb(bigDb); const kept = mb.__test.loadDb(); assert(Object.keys(kept.items).length === CAP); assert(!Object.keys(kept.items).some((k) => Number(k.slice(1)) < 30)); assert(Object.keys(kept.items).length > 0); ok(`historique borné à ${CAP} courriels (les traités, puis les plus anciens, sont oubliés d’abord)`);
  store.write('mailbox', { items: {} });

  // =====================================================================================================
  // 9. Lecture SEULE prouvée sur le (faux) client IMAP, à travers le vrai code de lecture
  // =====================================================================================================
  mail.listAccounts = realList; mail.readMany = realRead; mail._invalidate();
  const writes = []; const locks = []; const fetches = []; let inbox = [];
  const raw = (id, subj, body, flags = []) => ({ uid: id, flags: new Set(flags), internalDate: new Date(NOW.getTime() - 60000 * id), size: 500, source: Buffer.from(`From: Anne <anne@x.be>\r\nTo: moi@x.be\r\nSubject: ${subj}\r\nMessage-ID: <fake${id}@x.be>\r\nDate: ${new Date(NOW.getTime() - 60000 * id).toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`) });
  class FakeImap {
    constructor(opts) { this.opts = opts; this.mailbox = { exists: inbox.length }; return new Proxy(this, { get: (t, k) => { if (typeof k === 'symbol' || k === 'then' || k in t) return t[k]; return (...a) => { writes.push(String(k)); return Promise.resolve(); }; } }); }
    on() {} async connect() {} async logout() {} close() {}
    async getMailboxLock(name, o) { locks.push({ name, readOnly: o && o.readOnly === true }); return { release() {} }; }
    async *fetch(range, q) { fetches.push({ range, q }); for (const m of inbox) yield m; }
  }
  const ifp = require.resolve('imapflow'); require('imapflow'); const realImap = require.cache[ifp].exports; require.cache[ifp].exports = { ImapFlow: FakeImap };
  store.settings.set({ mail: { accounts: [] }, google: { accounts: [] } }); const created = mail.addAccount({ email: 'moi@x.be', imapHost: 'imap.x.be', smtpHost: 'smtp.x.be', imapPass: 'secret' });
  watch.__test.reset(); inbox = [raw(1, 'Ancien un', 'Vieux message.'), raw(2, 'Ancien deux', 'Autre vieux message.', ['\\Seen'])]; reset(); mail._invalidate();
  watch.start({ ...deps, firstDelay: 10 }); r = await watch.runOnce({ now: NOW }); assert(r.ok && r.accounts[0].baseline && natives.length === 0);
  inbox = [raw(3, 'Nouveau vrai message', 'Bonjour, voici du nouveau.'), ...inbox]; mail._invalidate(); reset(); r = await watch.runOnce({ now: at(4) });
  assert(r.fresh === 1 && natives.length === 1 && natives[0].body === 'Nouveau vrai message'); ok('chemin complet (vrai code de lecture, faux serveur IMAP) : nouveau message détecté et notifié');
  assert(writes.length === 0 && locks.length >= 2 && locks.every((l) => l.name === 'INBOX' && l.readOnly) && fetches.every((f) => !/flags\s*:\s*false/.test(JSON.stringify(f.q)))); ok('LECTURE SEULE : aucune méthode d’écriture appelée sur le client IMAP, boîte ouverte en lecture seule (INBOX, readOnly)');
  require.cache[ifp].exports = realImap; watch.stop(); store.settings.set({ mail: { accounts: [] } });

  // =====================================================================================================
  // 10. Interface : centre d'alertes (notify-ui.js) sous Node, avec un DOM minimal
  // =====================================================================================================
  class El {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.dataset = {}; this.className = ''; this._t = ''; this.listeners = {}; this.id = ''; this.style = {}; this.type = ''; this.title = ''; this.href = ''; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
    get firstChild() { return this.children[0] || null; } get lastChild() { return this.children[this.children.length - 1] || null; }
    get nextSibling() { if (!this.parentNode) return null; const a = this.parentNode.children; return a[a.indexOf(this) + 1] || null; }
    setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } removeAttribute(k) { delete this.attrs[k]; }
    appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) { if (c.parentNode) c.remove(); c.parentNode = this; const i = ref ? this.children.indexOf(ref) : this.children.length; this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
    remove() { if (this.parentNode) { const a = this.parentNode.children; a.splice(a.indexOf(this), 1); this.parentNode = null; } }
    get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); } set textContent(v) { this._t = String(v); this.children = []; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } fire(t, ev = {}) { for (const f of this.listeners[t] || []) f({ target: this, preventDefault() {}, ...ev }); }
    get classList() { const s = this; return { toggle(c, on) { const l = s.className.split(/\s+/).filter(Boolean); const has = l.includes(c); const want = on === undefined ? !has : on; s.className = (want ? [...new Set([...l, c])] : l.filter((x) => x !== c)).join(' '); }, contains: (c) => s.className.split(/\s+/).includes(c) }; }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    walk(f) { for (const c of this.children) { f(c); c.walk(f); } }
    find(pred) { let r = null; this.walk((c) => { if (!r && pred(c)) r = c; }); return r; } findAll(pred) { const r = []; this.walk((c) => { if (pred(c)) r.push(c); }); return r; }
    querySelector(sel) { const m = /^\.([\w-]+)$/.exec(sel); if (m) return this.find((c) => c.className.split(/\s+/).includes(m[1])); return null; }
    focus() { doc.activeElement = this; }
  }
  const doc = { documentElement: new El('html'), activeElement: null, visibilityState: 'visible', keyListeners: [] };
  doc.body = doc.documentElement.appendChild(new El('body')); doc.head = doc.documentElement.appendChild(new El('head')); doc.activeElement = doc.body;
  const navLink = doc.body.appendChild(new El('a')); navLink.dataset.page = 'courriels'; const sideFoot = doc.body.appendChild(new El('div')); sideFoot.className = 'side-foot'; const view = doc.body.appendChild(new El('div')); view.id = 'view'; view.focus = function () { doc.activeElement = this; };
  doc.createElement = (t) => new El(t); doc.getElementById = (id) => doc.body.find((c) => c.id === id) || doc.head.find((c) => c.id === id);
  doc.querySelector = (sel) => (sel === '#nav a[data-page="courriels"]' ? navLink : sel === '.side-foot' ? sideFoot : sel === '#modal-root .modal' ? (doc.modalOpen ? {} : null) : null);
  doc.addEventListener = (t, f) => { if (t === 'keydown') doc.keyListeners.push(f); };
  const nav = []; const mailOpens = []; const loc = { hash: '#accueil' };
  const J = { state: {}, speaking: false, go: (p) => { nav.push(p); loc.hash = '#' + p; }, call: async (m) => (m === 'mailbox.alertCount' ? { count: 4, urgent: 1 } : {}), mbOpenKey: (k) => mailOpens.push(k) };
  const timersUI = []; const ctx = vm.createContext({ document: doc, J, location: loc, console, setInterval: (f, ms) => { timersUI.push([f, ms]); return timersUI.length; }, clearInterval: () => {}, window: {} });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'renderer/notify-ui.js'), 'utf8'), ctx);
  const N = J.notify; const root = doc.getElementById('al-root');
  const cards = () => root.children.filter((c) => c.className.split(/\s+/).includes('al')); const more = () => root.find((c) => c.className.split(/\s+/).includes('al-more'));
  assert(root && root.getAttribute('role') === 'region' && root.getAttribute('aria-label') === 'Alertes' && doc.getElementById('al-css').textContent.includes('bottom:20px') && /right:20px/.test(doc.getElementById('al-css').textContent) && !/#al-root\{[^}]*top:/.test(doc.getElementById('al-css').textContent)); ok('centre d’alertes : région « Alertes », ancré en bas à droite (jamais en haut)');
  for (let i = 1; i <= 6; i++) N.push({ title: 'Alerte ' + i, detail: 'Détail ' + i });
  assert(cards().length === 4 && more() && more().firstChild.textContent === '+2 alertes' && cards().map((c) => c.find((x) => x.className === 'al-t').textContent).join() === 'Alerte 3,Alerte 4,Alerte 5,Alerte 6'); ok('empilement : 4 cartes visibles au plus (les plus récentes), les autres regroupées en « +2 alertes »');
  more().firstChild.fire('click'); assert(cards().length === 6 && more().firstChild.textContent === 'Réduire' && more().firstChild.getAttribute('aria-expanded') === 'true'); more().firstChild.fire('click'); assert(cards().length === 4); ok('« +N alertes » déplie la pile, « Réduire » la replie');
  N.clear(); assert(cards().length === 0 && !more());
  N.push({ title: 'Ordinaire', detail: 'd' }); N.push({ title: 'Urgente', detail: 'd', urgent: true, key: 'k1', type: 'mail' });
  const [ca, cb] = cards(); assert(ca.getAttribute('role') === 'status' && ca.getAttribute('aria-live') === 'polite' && cb.getAttribute('role') === 'alert' && cb.getAttribute('aria-live') === 'assertive');
  const mainBtn = cb.children[0], closeBtn = cb.children[1]; assert(mainBtn.tagName === 'BUTTON' && mainBtn.type === 'button' && closeBtn.tagName === 'BUTTON' && /^Fermer/.test(closeBtn.getAttribute('aria-label')) && /Urgente/.test(mainBtn.getAttribute('aria-label')) && mainBtn.getAttribute('aria-label').startsWith('Urgente. d')); assert(mainBtn.find((x) => x.className === 'al-ico').getAttribute('aria-hidden') === 'true'); ok('accessibilité : vrais boutons, role="status"/aria-live polite (ordinaire), role="alert" (urgent), libellés, icône masquée aux lecteurs d’écran');
  for (let i = 0; i < 20; i++) N.push({ title: 'Remplissage ' + i }); assert(cards().some((c) => c.dataset.urgent === '1')); ok('une alerte urgente reste visible même sous un flot d’alertes ordinaires');
  N.clear(); N.push({ id: 'a', title: 'Ordinaire' }); N.push({ id: 'b', title: 'Urgente', urgent: true });
  N._tick(11999); assert(cards().length === 2); N._tick(1); assert(cards().length === 1 && cards()[0].dataset.urgent === '1'); N._tick(1e9); assert(cards().length === 1); ok('une alerte ordinaire disparaît après 12 s ; l’urgente reste jusqu’au clic ou à la fermeture');
  N.push({ id: 'c', title: 'Survol' }); root.fire('mouseenter'); N._tick(60000); assert(cards().length === 2); root.fire('mouseleave'); N._tick(11999); assert(cards().length === 2); N._tick(1); assert(cards().length === 1); ok('pause au survol de la pile');
  N.push({ id: 'd', title: 'Focus' }); root.fire('focusin'); N._tick(60000); assert(cards().length === 2); root.fire('focusout'); doc.visibilityState = 'hidden'; N._tick(60000); assert(cards().length === 2); doc.visibilityState = 'visible'; N.dismiss('d'); ok('pause au focus clavier et quand la fenêtre est cachée');
  N.clear(); nav.length = 0; mailOpens.length = 0; loc.hash = '#accueil';
  N.push({ title: 'Courriel', detail: 'Sujet', type: 'mail', key: 'KEY1' }); doc.getElementById('al-root').find((c) => c.className === 'al-main').fire('click');
  assert(cards().length === 0 && nav.join() === 'courriels' && J.state.openMailKey === 'KEY1' && mailOpens.length === 0); ok('clic sur une alerte de courriel (hors page Courriels) : va dans Courriels et mémorise le courriel à ouvrir');
  const smart = new El('div'); smart.id = 'smartBox'; doc.body.appendChild(smart); loc.hash = '#courriels'; nav.length = 0; J.state.openMailKey = null;
  N.push({ title: 'Courriel 2', type: 'mail', key: 'KEY2' }); doc.getElementById('al-root').find((c) => c.className === 'al-main').fire('click');
  assert(mailOpens.join() === 'KEY2' && nav.length === 0 && J.state.openMailKey === null); ok('clic sur une alerte de courriel (déjà dans Courriels) : le courriel s’ouvre directement');
  N.push({ title: 'Groupe', type: 'mail', key: 'G1', keys: ['G1', 'G2'] }); doc.getElementById('al-root').find((c) => c.className === 'al-main').fire('click'); assert(mailOpens.pop() === 'G1');
  smart.remove(); loc.hash = '#veille'; nav.length = 0; N.push({ title: 'Veille', go: 'veille', type: 'veille' }); doc.getElementById('al-root').find((c) => c.className === 'al-main').fire('click'); assert(nav.join() === 'veille'); ok('alertes d’autres types : navigation vers leur page');
  let called = 0; N.push({ title: 'Perso', onClick: () => { called++; } }); doc.getElementById('al-root').find((c) => c.className === 'al-main').fire('click'); assert(called === 1);
  nav.length = 0; N.push({ title: 'Fermer sans ouvrir', type: 'mail', key: 'K9' }); doc.getElementById('al-root').find((c) => c.className === 'al-x').fire('click'); assert(cards().length === 0 && nav.length === 0 && J.state.openMailKey === null || J.state.openMailKey === 'KEY1'); ok('le bouton × ferme l’alerte sans rien ouvrir');
  loc.hash = '#courriels'; J.state.openMailKey = null; nav.length = 0; N.openMail('KZ'); assert(J.state.openMailKey === 'KZ' && nav.length === 0); ok('page Courriels en cours de chargement : le courriel est ouvert dès qu’elle est prête');
  N.clear(); N.push({ title: 'Une' }); N.push({ title: 'Deux' }); doc.activeElement = root.find((c) => c.className === 'al-main'); doc.keyListeners.forEach((f) => f({ key: 'Escape', target: doc.body, preventDefault() {} }));
  assert(cards().length === 1 && cards()[0].find((x) => x.className === 'al-t').textContent === 'Une'); ok('Échap (focus dans la pile) ferme l’alerte la plus récente');
  doc.activeElement = doc.body; doc.modalOpen = true; doc.keyListeners.forEach((f) => f({ key: 'Escape', target: doc.body, preventDefault() {} })); assert(cards().length === 1); doc.modalOpen = false;
  J.speaking = true; doc.keyListeners.forEach((f) => f({ key: 'Escape', target: doc.body, preventDefault() {} })); assert(cards().length === 1); J.speaking = false;
  doc.keyListeners.forEach((f) => f({ key: 'Escape', target: { tagName: 'INPUT' }, preventDefault() {} })); assert(cards().length === 1);
  doc.keyListeners.forEach((f) => f({ key: 'Escape', target: doc.body, preventDefault() {} })); assert(cards().length === 0); ok('Échap ne vole pas la touche à une fenêtre, à une lecture vocale ou à un champ de saisie');
  N.clear(); J.toast('Copié', 'ok'); J.toast('Copié', 'ok'); J.toast('Erreur', 'err'); assert(cards().length === 2 && cards()[1].getAttribute('role') === 'alert' && cards()[0].dataset.type === 'ok'); ok('J.toast reste compatible : même centre d’alertes, sans doublon, erreurs annoncées en « alert »');
  N.clear(); N.push({ title: '<img src=x onerror=alert(1)>', detail: '<b>gras</b>' }); const tt = cards()[0].find((x) => x.className === 'al-t'); assert(tt.textContent === '<img src=x onerror=alert(1)>' && tt.children.length === 0 && !cards()[0].find((x) => x.tagName === 'IMG' || x.tagName === 'B')); ok('contenu d’un courriel jamais interprété comme du HTML');
  N.clear(); assert(timersUI.length >= 1 && timersUI[0][1] === 250); ok('un seul minuteur léger (250 ms), arrêté quand la pile est vide');
  N.setCounts({ count: 5, urgent: 2 }); const badge = navLink.querySelector('.nav-badge'); assert(badge && badge.textContent === '5' && /hot/.test(badge.className) && /5 alertes de suivi, dont 2 urgentes/.test(navLink.getAttribute('aria-label'))); const sf = sideFoot.querySelector('.side-follow'); assert(sf && /5 à suivre · 2 urgents/.test(sf.textContent) && sf.href === '#courriels');
  N.setCounts({ count: 150, urgent: 0 }); assert(navLink.querySelector('.nav-badge').textContent === '99+' && !/hot/.test(navLink.querySelector('.nav-badge').className)); N.setCounts({ count: 0, urgent: 0 }); assert(!navLink.querySelector('.nav-badge') && !sideFoot.querySelector('.side-follow') && navLink.getAttribute('aria-label') === null); ok('badge « Courriels » + résumé dans la barre latérale (compteur, urgent, 99+, disparition à zéro)');
  await N.refresh(); assert(N.counts().count === 4 && N.counts().urgent === 1); N.pushMail({ id: 'mail-error:x', kind: 'error', title: 'Courriels : « Perso » injoignable', detail: 'Cause', go: 'courriels' }); assert(cards().some((c) => c.dataset.type === 'error' && c.dataset.id === 'mail-error:x')); ok('compteur rafraîchi par IPC ; alertes de la surveillance reçues telles quelles');

  // Rendu de la boîte intelligente (cartes « Alerte suivi », vues, note de classement local)
  const mj = { esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), fmtDate: (d) => d, errMsg: (e) => e.message, state: {}, act: {}, toast() {}, notify: { setCounts() {}, refresh() {} }, call: async (m, a) => { mjCalls.push([m, a]); return m === 'mailbox.triage' ? triage : { ok: true, items: [], total: 0, counts: {}, accounts: [] }; } };
  const mjCalls = []; const ai1 = { key: 'aaaa', subject: 'Dépôt <b>X</b>', from: 'Marie <marie@x.be>', fromName: 'Marie', accountLabel: 'Parlement', date: '2026-10-27T08:00:00Z', categories: ['reaction'], category: 'reaction', importance: 2, level: 'soon', reason: 'Échéance dans 2 jours', reasons: ['Échéance dans 2 jours', 'Sans réponse depuis 3 jours'], urgent: true, vip: false, summary: 'Résumé', source: 'règles', status: 'new' };
  const triage = { ok: true, at: '2026-10-27T10:00:00Z', total: 1, groups: { urgent: [], reaction: ['aaaa'], event: [], important: [], info: [], promo: [] }, items: { aaaa: { ...ai1 } }, counts: { urgent: 0, reaction: 1, event: 0, important: 0, info: 0, promo: 0 }, errors: [], notes: [], aiUsed: false, consentNeeded: false, aiConfigured: true, alerts: { count: 1, urgent: 1, followDays: 7, items: [ai1] } };
  const host = new El('div'); host.innerHTML = ''; const doc2 = { activeElement: null, getElementById: (id) => (id === 'smartBox' ? host : null), querySelector: () => null }; mj.state = {};
  const ctx2 = vm.createContext({ document: doc2, J: mj, window: {}, console, matchMedia: () => ({ matches: false }), setTimeout, clearTimeout }); vm.runInContext(fs.readFileSync(path.join(ROOT, 'renderer/mailbox-ui.js'), 'utf8'), ctx2);
  mj.mountMailbox(host); await new Promise((r) => setTimeout(r, 20)); const html = host.innerHTML;
  assert(/Classement local/.test(html) && /rien n'est déplacé|Rien n'est déplacé/.test(html) && /Historique classé/.test(html) && /Non lus à traiter/.test(html)); ok('interface : le classement local est clairement indiqué (rien n’est déplacé dans la vraie boîte)');
  const iAl = html.indexOf('Alerte suivi (1)'), iRe = html.indexOf('Attente de réaction (1)'); assert(iAl > 0 && iRe > iAl); ok('la section « Alerte suivi » est en tête de la boîte intelligente');
  assert(/Échéance dans 2 jours/.test(html) && /Aussi : Sans réponse depuis 3 jours/.test(html) && /Aussi dans : attente de réaction|Aussi dans : Attente de réaction/.test(html) && /data-act="mbSnooze"[^>]*data-days="1"/.test(html) && /data-days="7"/.test(html) && /data-act="mbVip"/.test(html) && !/<b>X<\/b>/.test(html) && /&lt;b&gt;X&lt;\/b&gt;/.test(html)); ok('carte d’alerte : raison affichée, « aussi dans… », rappel 1 jour / 1 semaine, ⭐ Toujours urgent, texte échappé');
  for (const a of ['mbReply', 'mbRead', 'mbShow', 'mbDone']) assert(new RegExp(`data-act="${a}" data-key="aaaa"`).test(html)); assert(/Aussi dans : Alerte suivi/.test(html)); ok('actions de la carte : Répondre, Lire, Afficher, Traité ; la carte de catégorie signale « Aussi dans : Alerte suivi »');
  mj.act.mbView({ dataset: { v: 'history' } }); await new Promise((r) => setTimeout(r, 20)); const hc = mjCalls.filter((c) => c[0] === 'mailbox.history'); assert(hc.length >= 1 && hc[0][1].status === 'all' && /Historique classé/.test(host.innerHTML) && /id="mhQ"/.test(host.innerHTML) && /id="mhFrom"/.test(host.innerHTML) && /id="mhCat"/.test(host.innerHTML) && /id="mhAcc"/.test(host.innerHTML)); ok('vue « Historique classé » : recherche, catégorie, compte, statut et plage de dates');
  const vh = mj.mbSectionsHtml({ ...triage, alertsOnly: true, groups: { urgent: [], reaction: [], event: [], important: [], info: [], promo: [] } }); assert(/Échéance dans 2 jours/.test(vh) && !/Attente de réaction \(/.test(vh)); ok('écran Jarvis : les alertes de suivi s’affichent avec les mêmes cartes');

  console.log('\nTous les tests de la surveillance des courriels passent ✅'); fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('\n❌ ÉCHEC :', e); process.exit(1); });
