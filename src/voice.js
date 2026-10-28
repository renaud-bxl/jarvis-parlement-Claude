// Voix. PARLER : voix humaines françaises open source (modèles Piper/VITS) exécutées hors-ligne par « jarvis-speak » (moteur sherpa-onnx, Apache-2.0), fourni avec l'app ;
// seules les voix (≈ 21 Mo chacune) sont téléchargées, à la demande.
// ÉCOUTER : reconnaissance vocale macOS (gratuite) ou Whisper via une API compatible OpenAI.
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const store = require('./store');

// Dossier temporaire PRIVÉ (0700) : les fichiers audio (voix de l'utilisateur, textes lus) ne traînent pas dans /tmp lisible par tous.
const tmpDir = () => { const d = path.join(store.DIR, 'tmp'); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
function cleanTmp() { try { const d = tmpDir(); for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (Date.now() - fs.statSync(f).mtimeMs > 600e3) fs.rmSync(f, { force: true }); } } catch { /* ok */ } }
cleanTmp();

const MODELS_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';
const VOICES = [
  { id: 'siwis', label: 'Siwis', gender: 'femme', model: 'vits-piper-fr_FR-siwis-medium-int8', sid: 0, mb: 21 },
  { id: 'jessica', label: 'Jessica', gender: 'femme', model: 'vits-piper-fr_FR-upmc-medium-int8', sid: 0, mb: 23 },
  { id: 'tom', label: 'Tom', gender: 'homme', model: 'vits-piper-fr_FR-tom-medium-int8', sid: 0, mb: 21 },
  { id: 'pierre', label: 'Pierre', gender: 'homme', model: 'vits-piper-fr_FR-upmc-medium-int8', sid: 1, mb: 23 },
];
const vdir = () => path.join(store.DIR, 'voice');
// Les voix fournies avec l'application (voix féminine par défaut) sont cherchées d'abord ; les autres sont téléchargées dans le dossier de données.
const bundledRoots = () => [process.resourcesPath && path.join(process.resourcesPath, 'voices'), path.join(__dirname, '..', 'native', 'build', 'voices')].filter(Boolean);
const okDir = (d) => fs.existsSync(path.join(d, 'tokens.txt')) && fs.existsSync(path.join(d, 'espeak-ng-data'));
const bundledDir = (v) => bundledRoots().map((r) => path.join(r, v.model)).find(okDir) || null;
const modelDir = (v) => bundledDir(v) || path.join(vdir(), 'models', v.model);
const hasModel = (v) => okDir(modelDir(v));
const speakBin = () => [
  process.resourcesPath && path.join(process.resourcesPath, 'jarvis-speak'),
  path.join(__dirname, '..', 'native', 'build', 'jarvis-speak'),
].filter(Boolean).find((p) => fs.existsSync(p));

function piperReady() {
  const cfg = store.settings.get().voice; const v = VOICES.find((x) => x.id === cfg.piperVoice) || VOICES[0];
  return !!speakBin() && hasModel(v);
}

function status() {
  return {
    engineInstalled: !!speakBin(),
    arch: process.arch,
    voices: VOICES.map((v) => ({ ...v, installed: hasModel(v), bundled: !!bundledDir(v) })),
  };
}

const MAX_VOICE_BYTES = 250 * 1024 * 1024;
const DOWNLOAD_HOSTS = /(^|\.)(github\.com|githubusercontent\.com)$/i;
async function download(url, dest, onProgress) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !DOWNLOAD_HOSTS.test(u.hostname)) throw new Error('Source de téléchargement refusée.');
  let res;
  try { res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60 * 1000) }); }
  catch (e) { throw new Error('Téléchargement impossible : vérifie ta connexion Internet (' + (e.cause?.code || e.message) + ').'); }
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  if (res.url && !DOWNLOAD_HOSTS.test(new URL(res.url).hostname)) throw new Error('Redirection vers un serveur non autorisé.');
  const total = Number(res.headers.get('content-length')) || 0; let got = 0;
  if (total > MAX_VOICE_BYTES) throw new Error('Fichier de voix anormalement volumineux : téléchargement annulé.');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const counter = new Transform({ transform(chunk, _e, cb) { got += chunk.length; if (got > MAX_VOICE_BYTES) return cb(new Error('Fichier de voix anormalement volumineux : téléchargement annulé.')); if (onProgress && total) onProgress(got / total); cb(null, chunk); } });
  try { await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp, { mode: 0o600 })); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  fs.renameSync(tmp, dest);
}

const run = (cmd, args, opts) => new Promise((res, rej) => execFile(cmd, args, opts, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));

// Télécharge la voix choisie (≈ 21 Mo) si absente, puis l'active.
const installing = new Set();
async function install(voiceId, emit = () => {}) {
  const v = VOICES.find((x) => x.id === voiceId); if (!v) throw new Error('Voix inconnue.');
  if (!speakBin()) throw new Error("Le moteur vocal n'est pas inclus dans cette version de l'app (réinstalle la dernière version).");
  if (installing.has(v.model)) throw new Error('Cette voix est déjà en cours de téléchargement.');
  installing.add(v.model);
  const tgz = path.join(vdir(), v.model + '.tar.bz2');
  try {
    if (!hasModel(v)) {
      await download(`${MODELS_URL}/${v.model}.tar.bz2`, tgz, (p) => emit('progress', { label: `Voix ${v.label} : ${Math.round(p * 100)} %` }));
      emit('progress', { label: `Voix ${v.label} : installation…` });
      fs.mkdirSync(path.join(vdir(), 'models'), { recursive: true });
      // Refuse toute archive contenant un chemin absolu ou « .. » (extraction hors du dossier voix).
      const listing = await run('tar', ['-tjf', tgz], { maxBuffer: 16 * 1024 * 1024 });
      if (String(listing).split('\n').some((l) => l.startsWith('/') || l.split('/').includes('..'))) throw new Error('Archive de voix refusée (chemins suspects).');
      await run('tar', ['-xjf', tgz, '-C', path.join(vdir(), 'models')]);
      if (!hasModel(v)) throw new Error('Voix introuvable après extraction.');
    }
  } finally { fs.rmSync(tgz, { force: true }); fs.rmSync(tgz + '.part', { force: true }); installing.delete(v.model); }
  fs.rmSync(path.join(vdir(), 'piper'), { recursive: true, force: true }); // ancien moteur (inutilisable) d'une version précédente
  store.settings.set({ voice: { engine: 'piper', piperVoice: v.id } });
  return status();
}

function removeVoice(voiceId) {
  const v = VOICES.find((x) => x.id === voiceId); if (!v) return status();
  stopEngines();
  if (bundledDir(v)) return status(); // voix fournie avec l'application : non supprimable
  if (!VOICES.some((o) => o.id !== v.id && o.model === v.model && hasModel(o) && store.settings.get().voice.piperVoice === o.id)) fs.rmSync(modelDir(v), { recursive: true, force: true });
  return status();
}

// Au démarrage : la voix de Jarvis est toujours une voix humaine. Voix choisie, sinon la voix féminine par défaut ; téléchargée seulement si elle n'est pas fournie avec l'application.
const wantedVoice = () => { const id = store.settings.get().voice.piperVoice; return VOICES.find((x) => x.id === id) || VOICES[0]; };
async function ensureDefault(emit = () => {}) {
  if (!speakBin()) return status();
  let v = wantedVoice();
  if (!hasModel(v)) { v = VOICES[0]; if (!hasModel(v)) { await install(v.id, emit); return status(); } store.settings.set({ voice: { engine: 'piper', piperVoice: v.id } }); }
  else if (store.settings.get().voice.engine !== 'piper') store.settings.set({ voice: { engine: 'piper', piperVoice: v.id } });
  return status();
}

// Un processus « jarvis-speak » par modèle, gardé en vie pour répondre vite. Les demandes sont traitées une par une.
const engines = new Map();
function stopEngines() { for (const e of engines.values()) { try { e.proc.kill(); } catch { /* ok */ } } engines.clear(); }
function engineFor(v) {
  let e = engines.get(v.id); if (e) return e;
  const proc = spawn(speakBin(), [modelDir(v), String(v.sid || 0)], { stdio: ['pipe', 'pipe', 'pipe'] });
  e = { proc, buf: '', waiters: [], queue: Promise.resolve(), dead: false, err: '' };
  const fail = (msg) => { e.dead = true; engines.delete(v.id); for (const w of e.waiters.splice(0)) w.reject(new Error(msg)); };
  proc.stdout.on('data', (d) => { e.buf += d; let i; while ((i = e.buf.indexOf('\n')) >= 0) { const line = e.buf.slice(0, i).trim(); e.buf = e.buf.slice(i + 1); const w = e.waiters.shift(); if (w) (line === 'READY' || line === 'OK') ? w.resolve() : w.reject(new Error(line.replace(/^ERR /, ''))); } });
  proc.stderr.on('data', (d) => { e.err = (e.err + d).slice(-300); });
  proc.stdin.on('error', (er) => fail('Moteur vocal : ' + er.message));
  proc.on('error', (er) => fail('Moteur vocal : ' + er.message));
  proc.on('close', () => fail('Le moteur vocal s\'est arrêté. ' + e.err.trim().slice(-150)));
  e.ready = new Promise((resolve, reject) => { e.waiters.push({ resolve, reject }); });
  engines.set(v.id, e); return e;
}

// Synthétise un court texte → WAV (base64).
function synth(text) {
  const cfg = store.settings.get().voice; const v = VOICES.find((x) => x.id === cfg.piperVoice) || VOICES[0];
  if (!speakBin() || !hasModel(v)) return Promise.reject(new Error('Voix humaine non installée (Réglages › Voix).'));
  const rate = Math.min(1.5, Math.max(0.6, Number(cfg.ttsRate) || 1));
  const clean = String(text).replace(/[\t\r\n]+/g, ' ').trim().slice(0, 1500); if (!clean) return Promise.resolve('');
  const e = engineFor(v);
  const job = e.queue.then(async () => {
    await Promise.race([e.ready, new Promise((_r, rej) => setTimeout(() => rej(new Error('Chargement de la voix trop long.')), 30000))]);
    const out = path.join(tmpDir(), `jarvis-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`);
    const done = new Promise((resolve, reject) => { e.waiters.push({ resolve, reject }); });
    e.proc.stdin.write(`${rate}\t${out}\t${clean}\n`);
    const timer = setTimeout(() => { try { e.proc.kill(); } catch { /* ok */ } }, 60000);
    try { await done; return fs.readFileSync(out).toString('base64'); } finally { clearTimeout(timer); fs.rmSync(out, { force: true }); }
  });
  e.queue = job.catch(() => {});
  return job;
}

// Charge la voix en mémoire dès le démarrage : la première phrase est alors prononcée sans attente.
function warm() { try { const v = wantedVoice(); if (speakBin() && hasModel(v)) engineFor(v).ready.catch(() => {}); } catch { /* sera réessayé à la première phrase */ } }

// ---- Écoute (transcription) ----
// Moteur 1 (par défaut) : reconnaissance vocale de macOS via l'assistant « jarvis-listen » — gratuit, sans clé, sur l'appareil quand c'est possible.
// Moteur 2 : Whisper via une API compatible OpenAI (OpenAI, ou serveur local open source type whisper.cpp).
const listenBin = () => [
  process.resourcesPath && path.join(process.resourcesPath, 'jarvis-listen'),
  path.join(__dirname, '..', 'native', 'build', 'jarvis-listen'),
].filter(Boolean).find((p) => fs.existsSync(p));
const macosReady = () => process.platform === 'darwin' && !!listenBin();
function whisperConfigured() {
  const v = store.settings.get().voice;
  if (!v.sttUrl) return false;
  try { const h = new URL(v.sttUrl).hostname; if (['localhost', '127.0.0.1', '::1'].includes(h)) return true; } catch { return false; }
  return store.hasSecret('stt_key');
}
const engine = () => { const v = store.settings.get().voice; return v.stt === 'whisper' ? (whisperConfigured() ? 'whisper' : null) : (macosReady() ? 'macos' : (whisperConfigured() ? 'whisper' : null)); };
const configured = () => !!engine();

// offline = true : écoute permanente (mot de réveil) — uniquement sur l'appareil, jamais de repli vers les serveurs d'Apple.
function transcribeMacos(buf, lang, offline = false) {
  const f = path.join(tmpDir(), `jarvis-stt-${process.pid}-${Date.now()}.wav`); fs.writeFileSync(f, buf, { mode: 0o600 });
  const args = [f, lang === 'nl' ? 'nl-BE' : lang === 'en' ? 'en-GB' : 'fr-FR']; if (offline) args.push('offline');
  return new Promise((resolve, reject) => {
    execFile(listenBin(), args, { timeout: 95000 }, (e, so, se) => {
      fs.rmSync(f, { force: true }); const err = String(se || '');
      const mode = /MODE:online/.test(err) ? 'online' : 'device';
      if (e) {
        const m = err || e.message;
        if (/AUTORISATION_REFUSEE/.test(m)) { const x = new Error('Reconnaissance vocale refusée : autorise Jarvis Parlement dans Réglages Système › Confidentialité et sécurité › Reconnaissance vocale.'); x.code = 'SPEECH'; return reject(x); }
        if (/AUTORISATION_ATTENTE/.test(m)) { const x = new Error("macOS n'a pas affiché la demande d'accès à la reconnaissance vocale. Ouvre Réglages Système › Confidentialité et sécurité › Reconnaissance vocale et active Jarvis Parlement (ajoute-le avec « + » s'il n'est pas dans la liste)."); x.code = 'SPEECH'; return reject(x); }
        if (/HORS_LIGNE/.test(m)) { const x = new Error("La reconnaissance vocale hors-ligne du français n'est pas installée sur ce Mac : Réglages Système › Clavier › Dictée › Langues › ajoute le français."); x.code = 'OFFLINE'; return reject(x); }
        return reject(new Error(m.replace(/^\w+ : /, '').replace(/MODE:\w+/g, '').trim().slice(0, 200) || 'Reconnaissance vocale impossible.'));
      }
      const text = String(so).trim(); if (text) store.markOnboarding('micOk', 'speechOk'); // une phrase reconnue prouve que micro et reconnaissance vocale fonctionnent
      resolve({ text, mode });
    });
  });
}

// État de l'autorisation « Reconnaissance vocale » de macOS : authorized | denied | restricted | notDetermined | indisponible. ask = true : affiche la demande à l'utilisateur.
function speechStatus(ask = false) {
  if (!macosReady()) return Promise.resolve('indisponible');
  return new Promise((resolve) => execFile(listenBin(), [ask ? '--authorize' : '--status'], { timeout: 55000 }, (e, so) => resolve(e ? 'indisponible' : (String(so).trim() || 'indisponible'))));
}

async function transcribe({ audio, mime, offline } = {}) {
  const v = store.settings.get().voice; const st = store.settings.get();
  const eng = engine();
  if (!eng) throw new Error("Aucune reconnaissance vocale disponible (Réglages › Voix). En attendant, utilise la dictée macOS : appuie deux fois sur Fn.");
  if (typeof audio !== 'string' || !audio) throw new Error('Enregistrement vide.');
  if (audio.length > 34 * 1024 * 1024) throw new Error("Enregistrement trop long (25 Mo maximum) : parle par phrases plus courtes.");
  const buf = Buffer.from(audio, 'base64');
  if (buf.length < 1500) throw new Error('Enregistrement trop court.');
  mime = typeof mime === 'string' ? mime.slice(0, 60) : '';
  if (eng === 'macos') return transcribeMacos(buf, st.profile.langue, offline === true);
  if (offline === true) throw new Error("L'écoute permanente demande la reconnaissance hors-ligne de macOS (aucun son n'est envoyé sur Internet).");
  let url; try { url = new URL(v.sttUrl); } catch { throw new Error("Adresse du serveur de transcription invalide (Réglages › Voix)."); }
  const key = store.getSecret('stt_key');
  const loop = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loop)) throw new Error("Le serveur de transcription doit utiliser https:// (ou tourner sur cet ordinateur).");
  const ext = /wav/.test(mime) ? 'wav' : /mp4|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime || 'audio/webm' }), `voix.${ext}`);
  form.append('model', v.sttModel || 'whisper-1'); form.append('language', st.profile.langue || 'fr'); form.append('response_format', 'json');
  let res;
  try { res = await fetch(v.sttUrl.replace(/\/$/, '') + '/audio/transcriptions', { method: 'POST', headers: key ? { authorization: 'Bearer ' + key } : {}, body: form, redirect: 'error', signal: AbortSignal.timeout(90000) }); }
  catch (e) { throw new Error('Serveur de transcription injoignable (' + (e.name === 'TimeoutError' ? 'délai dépassé' : (e.cause?.code || e.message)) + '). Vérifie ta connexion et l\'adresse dans Réglages › Voix.'); }
  const txt = (await res.text()).slice(0, 2 * 1024 * 1024); let j = null; try { j = JSON.parse(txt); } catch { /* brut */ }
  if (!res.ok) throw new Error(`Transcription refusée (${res.status}) : ${String(j?.error?.message || txt).slice(0, 200).replace(/sk-[A-Za-z0-9_-]+/g, '…')}`);
  return { text: String(j?.text ?? txt).trim() };
}

// Chemins des moteurs natifs (diagnostic).
const binaries = () => ({ speak: speakBin() || null, listen: listenBin() || null });

module.exports = { VOICES, binaries, speechStatus, ensureDefault, warm, piperReady, status, install, removeVoice, synth, stopEngines, configured, engine, macosReady, transcribe };
