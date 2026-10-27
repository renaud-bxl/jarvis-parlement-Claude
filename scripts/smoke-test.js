// Test de fumée du backend (sans réseau : fetch est simulé). Lancer : npm test
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-'));
process.env.JARVIS_DATA_DIR = path.join(tmp, 'data'); process.env.JARVIS_DOCS_DIR = path.join(tmp, 'Jarvis-Parlement');

let lastBody = null;
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body); lastBody = body;
  const sys = String(body.system || ''); let text = 'OK';
  if (sys.includes('module de mémoire')) text = JSON.stringify({ add: [{ text: 'Préfère des questions courtes et chiffrées', category: 'style' }], reinforce: [], remove: [] });
  else if (sys.includes('veille parlementaire')) text = JSON.stringify({ items: [{ titre: 'Tram 10 : nouveaux retards', resume: 'Retards récurrents', url: 'https://exemple.be/a', date: '2026-10-26', source: 'Bruzz', pertinence: 3, piste: 'Question orale sur la ponctualité' }] });
  else if (sys.includes('MODÈLE À SUIVRE')) text = '## Contexte\nTexte de test\n## À vérifier avant dépôt';
  else if (sys.includes('recherche web')) text = '## Résumé\nRésultat de recherche';
  return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) };
};

const store = require('../src/store'); const wsp = require('../src/workspace'); const templates = require('../src/templates');
const dossiers = require('../src/dossiers'); const brain = require('../src/brain'); const indexer = require('../src/indexer');
const research = require('../src/research'); const mail = require('../src/mail'); const scheduler = require('../src/scheduler'); const llm = require('../src/llm');

(async () => {
  const ok = (m) => console.log('  ✓', m);
  // Parlements multiples + dossiers automatiques
  wsp.ensureAll(); assert(fs.existsSync(path.join(store.DOCS_DEFAULT, 'Parlement-Bruxelles', '01-Veille'))); ok('dossier Parlement-Bruxelles + sous-dossiers créés');
  store.settings.set({ profile: { parlements: ['bxl-pb', 'benelux'] } }); wsp.ensureAll();
  assert(fs.existsSync(path.join(store.DOCS_DEFAULT, 'Parlement-Benelux', '03-Interpellations-et-Questions'))); ok('ajout du Parlement Benelux → dossier créé automatiquement');
  const p = templates.addParlement({ nom: 'Conseil communal de Test', niveau: 'Commune', baseOn: 'bxl-pb' });
  store.settings.set({ profile: { parlements: ['bxl-pb', 'benelux', p.id] } }); wsp.ensureAll();
  assert(fs.existsSync(path.join(store.DOCS_DEFAULT, 'Parlement-Conseil-communal-de-Test', '06-Archives'))); assert(templates.find(p.instruments[0].id)); ok('parlement personnalisé + modèles clonés + dossier');
  assert(templates.instructions('benelux-ecrite').includes('Dimension transfrontalière')); ok('modèle Benelux distinct du modèle bruxellois');

  // Moteur IA simulé
  store.setSecret('anthropic_key', 'sk-test'); assert(llm.configured()); assert.strictEqual(store.getSecret('anthropic_key'), 'sk-test'); ok('secret stocké et relu');

  // Rédaction → fichier + cerveau
  const d = dossiers.create({ title: 'Tram 10', parlement: 'bxl-pb', instrument: 'bxl-pb-interp' });
  const dr = await research.draft({ instrumentId: 'bxl-pb-interp', subject: 'Retards du tram 10', dossierId: d.id });
  assert(dr.text.includes('Contexte') && fs.existsSync(dr.file) && dr.file.includes('03-Interpellations')); ok('brouillon généré + classé dans 03-Interpellations');
  await new Promise((r) => setTimeout(r, 300)); assert(brain.list().facts.some((f) => f.category === 'style')); ok('le cerveau a appris une préférence');
  assert(brain.promptBlock().includes('questions courtes')); ok('la préférence est réinjectée dans les prompts');
  await brain.learnFromEdit('a', 'b', 'test'); ok('apprentissage par correction OK');

  // Recherche → fichier
  const rr = await research.webResearch({ query: 'ZBE Bruxelles', parlement: 'benelux' }); assert(rr.file.includes('Parlement-Benelux') && rr.file.includes('02-Recherches')); ok('recherche classée dans le dossier du parlement ciblé');

  // Veille
  store.settings.set({ veille: { topics: [{ label: 'Mobilité', keywords: '', parlement: '' }] } });
  const v = await research.runVeille(); assert.strictEqual(v.created, 1);
  assert(fs.readdirSync(path.join(store.DOCS_DEFAULT, 'Parlement-Bruxelles', '01-Veille')).length === 1); ok('veille exécutée + rapport dans 01-Veille');
  store.settings.set({ veille: { lastRun: null } }); scheduler.configure({ enabled: true, time: '00:00', days: [0, 1, 2, 3, 4, 5, 6] }); assert(scheduler.due(store.settings.get().veille)); ok('planification due');
  scheduler.remove(); assert(!scheduler.status().enabled); ok('veille automatique retirée');

  // Index
  const docs = path.join(store.DOCS_DEFAULT, 'Parlement-Bruxelles', '04-Documents'); fs.writeFileSync(path.join(docs, 'budget.txt'), 'Le budget 2026 de la mobilité à Bruxelles prévoit 120 millions pour le tram.');
  fs.writeFileSync(path.join(docs, 'autre.md'), 'Rapport sur la propreté publique.');
  const idx = await indexer.build(); assert(idx.files >= 2);
  const hits = indexer.search('budget mobilité tram'); assert(hits[0].name === 'budget.txt'); ok('index + recherche BM25 : ' + hits[0].name);
  const an = await research.analyzeDocument({ file: path.join(docs, 'budget.txt'), question: 'Résume', allowCloud: true }); assert(an.answer); ok('analyse de document locale (sans web)');
  assert(!lastBody.tools, 'aucun outil web pour l\'analyse de document'); ok('aucun outil web envoyé lors de l\'analyse');
  await assert.rejects(() => research.analyzeDocument({ file: path.join(docs, 'budget.txt') }), /cloud/); ok('refus sans autorisation cloud');

  // Courriel
  mail.addAccount({ email: 'moi@exemple.be', imapHost: 'imap.exemple.be', smtpHost: 'smtp.exemple.be', imapPass: 'x' });
  const raw = mail.buildEml({ from: 'moi@exemple.be', to: 'Min <min@gov.be>', bcc: 'x@y.be', subject: 'Question été', body: 'Bonjour' });
  const prep = mail.prepareSend('imap_moi_exemple_be', raw); assert.deepStrictEqual(prep.to, ['min@gov.be']); assert.deepStrictEqual(prep.bcc, ['x@y.be']); ok('préparation d\'envoi : destinataires complets affichés');
  assert.throws(() => mail.prepareSend('imap_moi_exemple_be', raw.replace('moi@exemple.be', 'autre@x.be')), /ne correspond pas/); ok('From usurpé refusé');
  await assert.rejects(() => mail.send('imap_moi_exemple_be', raw, 'a', 'b'), /non confirmé/); ok('envoi sans confirmation refusé');

  // Jarvis conversationnel
  const jv = require('../src/jarvis');
  const g = jv.greeting(); assert(g.intro.startsWith('Bonjour') && g.intro.includes("Que puis-je faire pour vous aujourd'hui ?") && /checker vos mails/.test(g.offer) && /veille/.test(g.offer)); ok('salutation : Bonjour + question + capacités');
  store.settings.set({ profile: { nom: 'Camille Martin' } }); assert(jv.greeting().intro === "Bonjour Camille Martin. Que puis-je faire pour vous aujourd'hui ?"); ok('salutation avec le nom de l\'utilisateur');
  assert.strictEqual(jv.fastRoute('Check mes mails').intent, 'mails'); assert.strictEqual(jv.fastRoute('fais une veille sur la ZBE').args.topic, 'la ZBE'); assert.strictEqual(jv.fastRoute('Quel est mon agenda demain ?').args.days, 2); ok('comprend « check mes mails », « fais une veille sur… », « agenda demain »');
  store.settings.set({ mail: { accounts: [] } }); let r = await jv.command({ text: 'check mes mails' }); assert(r.ok && /compte courriel/.test(r.say) && r.navigate === 'courriels'); ok('mails sans compte → explique et ouvre Courriels');
  store.write('veille', { items: [], runs: [] }); r = await jv.command({ text: 'fais une veille sur la mobilité douce' }); assert(r.ok && r.intent === 'veille_topic' && r.md.includes('Tram 10') && r.say); ok('veille sur un sujet → résultats + réponse parlée');
  r = await jv.command({ text: 'rédige une question sur le tram 10' }).catch((e) => ({ ok: false, error: e.message })); assert(r.ok === true || /Texte de test|brouillon|Tram/.test(JSON.stringify(r))); ok('rédaction vocale → brouillon');
  r = await jv.command({ text: 'merci' }); assert(r.end === true); ok('« merci » termine la conversation');
  r = await jv.command({ text: 'retiens que je préfère des questions courtes' }); assert(/noté/.test(r.say)); ok('« retiens que… » alimente le cerveau');
  const vc = require('../src/voice'); assert(vc.VOICES.some((x) => x.gender === 'femme') && vc.VOICES.some((x) => x.gender === 'homme')); assert(vc.status().voices.every((x) => x.installed === false)); ok('voix humaines : femmes et hommes proposés, aucune installée par défaut');
  // Courriels : HTML → texte, lecture à voix haute, réponse
  const mtx = require('../src/mailtext');
  const nm = mtx.normalize({ text: '<!DOCTYPE html><html><head><style>a{}</style></head><body><p>Bonjour &eacute;quipe,</p><p>Voir <a href="https://x.be">ici</a></p></body></html>' });
  assert(!/<|DOCTYPE/.test(nm.text) && nm.text.includes('Bonjour équipe') && nm.html.includes('<body>')); ok('un courriel HTML ne s\'affiche plus en code : texte propre + HTML conservé pour l\'affichage visuel');
  const sp = mtx.speakable('Bonjour.\n> cité\nLien https://x.be/abc fin.'); assert(!/https|cité/.test(sp.text)); ok('texte lu à voix haute : sans liens ni citations');
  const rp = mtx.replyPrefill({ from: 'Jean <j@x.be>', replyTo: 'r@x.be', subject: 'Test', date: '2026-10-27T10:00:00Z', text: 'Salut', messageId: '<1@x>' }); assert(rp.to === 'r@x.be' && rp.subject === 'Re : Test' && rp.quote.includes('> Salut') && rp.inReplyTo === '<1@x>'); ok('réponse : destinataire, objet « Re : », citation, chaînage');
  const eml = mail.buildEml({ from: 'moi@exemple.be', to: 'j@x.be', subject: 'Re : Test', body: 'ok', inReplyTo: '<1@x>', references: '<1@x>' }); assert(/In-Reply-To: <1@x>/.test(eml) && /References: <1@x>/.test(eml)); ok('le .eml de réponse garde In-Reply-To / References');
  const jv2 = require('../src/jarvis'); assert.strictEqual(jv2.fastRoute('lis-moi tous les mails').intent, 'mails_read'); assert.strictEqual(jv2.fastRoute('réponds au premier mail en disant que je confirme').args.instruction, 'je confirme'); assert.strictEqual(jv2.fastRoute('lis le deuxième mail').args.index, 2); ok('commandes vocales : « lis tous les mails », « lis le deuxième », « réponds au premier… »');
  const rd = await research.replyDraft({ message: { from: 'Jean <j@x.be>', subject: 'RDV', text: 'Peux-tu venir ?' }, instruction: 'je confirme', allowCloud: true }); assert(rd.text); ok('réponse proposée par Jarvis');
  console.log('\nTous les tests passent ✅'); fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('\n❌ ÉCHEC :', e); process.exit(1); });
