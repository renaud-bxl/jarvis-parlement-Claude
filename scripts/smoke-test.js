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
  console.log('\nTous les tests passent ✅'); fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('\n❌ ÉCHEC :', e); process.exit(1); });
