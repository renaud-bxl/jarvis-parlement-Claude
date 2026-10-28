// Tests : mot de réveil « Hé Jarvis », voix féminine incluse (jamais la voix du Mac), reconnaissance hors-ligne. Lancer : node scripts/test-wake.js
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const vm = require('vm');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-wake-'));
process.env.JARVIS_DATA_DIR = path.join(tmp, 'data'); process.env.JARVIS_DOCS_DIR = path.join(tmp, 'docs'); process.env.JARVIS_INSECURE_SECRETS = '1';
const ok = (m) => console.log('  ✓', m);

// ---- Mot de réveil : extraction du code réel de renderer/jarvis.js ----
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'jarvis.js'), 'utf8');
const a = src.indexOf('const WAKE_PRE'), b = src.indexOf('const micPill');
assert(a > 0 && b > a, 'définition du mot de réveil introuvable');
const ctx = { J: {} }; vm.createContext(ctx); vm.runInContext(src.slice(a, b), ctx);
const split = (t) => ctx.J.wakeSplit(t);
for (const [t, rest] of [
  ['Hé Jarvis, check mes mails', 'check mes mails'], ['Hey Jarvis fais une veille sur le logement', 'fais une veille sur le logement'], ['Et Jarvis qu\'est-ce que tu sais faire', 'qu\'est-ce que tu sais faire'],
  ['Ok Jarvis', ''], ['Jarvis', ''], ['Salut Jarvis, quelles sont mes échéances ?', 'quelles sont mes échéances ?'], ['hé, Jarvis ! rédige une question sur le tram', 'rédige une question sur le tram'], ['JARVIS lis mes mails', 'lis mes mails'], ['Bonjour Jarvis vérifie mes courriels', 'vérifie mes courriels'],
]) { const r = split(t); assert(r.woke && r.rest === rest, `réveil attendu : « ${t} » → « ${rest} » (obtenu ${JSON.stringify(r)})`); }
ok('réveil : « Hé / Hey / Et / Ok / Salut / Bonjour Jarvis », avec ou sans la demande dans la même phrase');
for (const t of ['Bonjour tout le monde nous parlons de choses sans rapport', 'Je pense que Jarvis est un bon assistant', 'Le film Iron Man a un majordome qui s\'appelle Jarvis', 'check mes mails', 'Hé Marie, tu viens ?', '']) assert(!split(t).woke, `faux réveil : « ${t} »`);
ok('pas de faux réveil : conversations voisines, « Jarvis » au milieu d\'une phrase, phrases sans mot de réveil');

(async () => {
  const store = require('../src/store'); const voice = require('../src/voice');
  // ---- Voix féminine fournie avec l'application ----
  const res = path.join(tmp, 'Resources'); const vdir = path.join(res, 'voices', 'vits-piper-fr_FR-siwis-medium-int8');
  fs.mkdirSync(path.join(vdir, 'espeak-ng-data'), { recursive: true }); fs.writeFileSync(path.join(vdir, 'tokens.txt'), 'x'); fs.writeFileSync(path.join(res, 'jarvis-speak'), '#!/bin/sh\n', { mode: 0o755 });
  Object.defineProperty(process, 'resourcesPath', { value: res, configurable: true });
  assert(voice.piperReady()); const st = voice.status(); const siwis = st.voices.find((v) => v.id === 'siwis'); assert(siwis.installed && siwis.bundled && siwis.gender === 'femme'); assert(!st.voices.find((v) => v.id === 'tom').installed); ok('la voix féminine (Siwis) est fournie avec l\'application : prête dès l\'installation, sans téléchargement');
  assert(voice.VOICES.some((v) => v.gender === 'femme') && voice.VOICES.some((v) => v.gender === 'homme')); ok('au choix dans les Réglages : voix de femme et voix d\'homme');
  // ---- Migration : l'ancien réglage « voix du système » est remplacé ----
  store.settings.set({ voice: { engine: 'system', piperVoice: 'siwis' } }); await voice.ensureDefault(); assert.strictEqual(store.settings.get().voice.engine, 'piper'); ok('ancien réglage « voix système » → voix humaine, sans téléchargement');
  store.settings.set({ voice: { engine: 'piper', piperVoice: 'tom' } }); await voice.ensureDefault(); assert.strictEqual(store.settings.get().voice.piperVoice, 'siwis'); ok('voix choisie absente du disque → retour automatique à la voix féminine fournie');
  // ---- Voix supprimable ? La voix fournie ne l'est pas ----
  voice.removeVoice('siwis'); assert(fs.existsSync(path.join(vdir, 'tokens.txt'))); ok('la voix fournie avec l\'application ne peut pas être supprimée');
  // ---- Le renderer n'utilise plus jamais la voix du système ----
  const ui = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ui.js'), 'utf8'); assert(!/SpeechSynthesisUtterance|speechSynthesis\.speak/.test(ui)); ok('aucun appel à la synthèse vocale du système dans l\'interface');
  const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'api.js'), 'utf8'); assert(!/\['piper', 'system'\]/.test(api)); ok('le réglage « system » n\'est plus accepté');
  // ---- Écoute hors-ligne (mot de réveil) : jamais d'envoi à Internet ----
  fs.writeFileSync(path.join(res, 'jarvis-listen'), '#!/bin/sh\necho "MODE:device" 1>&2\necho "Hé Jarvis bonjour"\n', { mode: 0o755 });
  const wav = Buffer.alloc(4000).toString('base64'); const r = await voice.transcribe({ audio: wav, mime: 'audio/wav', offline: true }); assert(r.text.includes('Jarvis') && r.mode === 'device'); ok('transcription hors-ligne : texte et mode « sur l\'appareil » renvoyés');
  fs.writeFileSync(path.join(res, 'jarvis-listen'), '#!/bin/sh\necho "HORS_LIGNE : x" 1>&2\nexit 7\n', { mode: 0o755 });
  await assert.rejects(() => voice.transcribe({ audio: wav, mime: 'audio/wav', offline: true }), /hors-ligne du français n'est pas installée/); ok('reconnaissance hors-ligne absente : message clair, jamais de repli vers les serveurs d\'Apple');
  fs.writeFileSync(path.join(res, 'jarvis-listen'), '#!/bin/sh\necho "AUTORISATION_REFUSEE" 1>&2\nexit 3\n', { mode: 0o755 });
  await assert.rejects(() => voice.transcribe({ audio: wav, mime: 'audio/wav', offline: true }), /Reconnaissance vocale refusée/); ok('autorisation macOS refusée : message avec le chemin des Réglages Système');
  // ---- Assistant de mise en route : les étapes cochées sont bien enregistrées ----
  const apiObj = require('../src/api').create({ dialog: {}, shell: {}, app: { isPackaged: false, getVersion: () => 'test', setLoginItemSettings() {}, getLoginItemSettings: () => ({}) }, getWindow: () => null, emit() {} });
  await apiObj['settings.set']({ onboarding: { aiOk: true, micOk: true, speechOk: true, evil: true, dismissed: 'oui' } });
  const ob = store.settings.get().onboarding; assert(ob.aiOk === true && ob.micOk === true && ob.speechOk === true && ob.dismissed === true && !('evil' in ob)); ok('étapes de la mise en route (moteur IA testé, micro, reconnaissance vocale) enregistrées — seules les clés prévues sont acceptées');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8'); assert(/done: !!o\.micOk && !!o\.speechOk/.test(appJs)); ok('étape « micro » cochée seulement quand micro ET reconnaissance vocale sont autorisés');
  // ---- État de l'autorisation « Reconnaissance vocale » ----
  fs.writeFileSync(path.join(res, 'jarvis-listen'), '#!/bin/sh\necho "$1"\n', { mode: 0o755 });
  assert.strictEqual(await voice.speechStatus(false), '--status'); assert.strictEqual(await voice.speechStatus(true), '--authorize'); ok('état de l\'autorisation vocale : lecture simple, ou demande affichée à l\'utilisateur');
  fs.writeFileSync(path.join(res, 'jarvis-listen'), '#!/bin/sh\necho "AUTORISATION_ATTENTE : x" 1>&2\nexit 8\n', { mode: 0o755 });
  await assert.rejects(() => voice.transcribe({ audio: Buffer.alloc(4000).toString('base64'), mime: 'audio/wav' }), /n'a pas affiché la demande/); ok('demande macOS jamais affichée : message clair avec le chemin des Réglages Système');
  // ---- Les étapes se cochent toutes seules dès que ça fonctionne réellement ----
  store.settings.set({ onboarding: { aiOk: false, micOk: false, speechOk: false } });
  const llm = require('../src/llm'); global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }) });
  store.setSecret('anthropic_key', 'sk-test'); store.settings.set({ ai: { provider: 'anthropic' } });
  assert(!store.settings.get().onboarding.aiOk); await llm.complete({ prompt: 'ping', maxTokens: 16 }); assert(store.settings.get().onboarding.aiOk === true); ok('un appel IA réussi coche l\'étape « Moteur IA » sans passer par le bouton de test');
  fs.writeFileSync(path.join(res, 'jarvis-listen'), '#!/bin/sh\necho "MODE:device" 1>&2\necho "bonjour Jarvis"\n', { mode: 0o755 });
  assert(!store.settings.get().onboarding.micOk); await voice.transcribe({ audio: Buffer.alloc(4000).toString('base64'), mime: 'audio/wav' }); const o2 = store.settings.get().onboarding; assert(o2.micOk === true && o2.speechOk === true); ok('une phrase reconnue coche micro et reconnaissance vocale');
  assert(/setup-x/.test(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8'))); ok('le rappel « Mise en route » de la barre latérale peut être masqué (×)');
  console.log('\nTous les tests micro / voix passent ✅'); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.error('\n❌ ÉCHEC :', e); process.exit(1); });
