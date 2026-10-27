// Voix. PARLER : voix humaines françaises open source (modèles Piper/VITS) exécutées hors-ligne par « jarvis-speak » (moteur sherpa-onnx, Apache-2.0), fourni avec l'app ;
// seules les voix (≈ 21 Mo chacune) sont téléchargées, à la demande.
// ÉCOUTER : reconnaissance vocale macOS (gratuite) ou Whisper via une API compatible OpenAI.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const store = require('./store');

const MODELS_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';
const VOICES = [
  { id: 'siwis', label: 'Siwis', gender: 'femme', model: 'vits-piper-fr_FR-siwis-medium-int8', sid: 0, mb: 21 },
  { id: 'jessica', label: 'Jessica', gender: 'femme', model: 'vits-piper-fr_FR-upmc-medium-int8', sid: 0, mb: 23 },
  { id: 'tom', label: 'Tom', gender: 'homme', model: 'vits-piper-fr_FR-tom-medium-int8', sid: 0, mb: 21 },
  { id: 'pierre', label: 'Pierre', gender: 'homme', model: 'vits-piper-fr_FR-upmc-medium-int8', sid: 1, mb: 23 },
];
const vdir = () => path.join(store.DIR, 'voice');
const modelDir = (v) => path.join(vdir(), 'models', v.model);
const hasModel = (v) => fs.existsSync(path.join(modelDir(v), 'tokens.txt')) && fs.existsSync(path.join(modelDir(v), 'espeak-ng-data'));
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
    voices: VOICES.map((v) => ({ ...v, installed: hasModel(v) })),
  };
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  const total = Number(res.headers.get('content-length')) || 0; let got = 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part'; const out = fs.createWriteStream(tmp);
  for await (const chunk of res.body) { out.write(chunk); got += chunk.length; if (onProgress && total) onProgress(got / total); }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, dest);
}

const run = (cmd, args, opts) => new Promise((res, rej) => execFile(cmd, args, opts, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));

// Télécharge la voix choisie (≈ 21 Mo) si absente, puis l'active.
async function install(voiceId, emit = () => {}) {
  const v = VOICES.find((x) => x.id === voiceId); if (!v) throw new Error('Voix inconnue.');
  if (!speakBin()) throw new Error("Le moteur vocal n'est pas inclus dans cette version de l'app (réinstalle la dernière version).");
  if (!hasModel(v)) {
    const tgz = path.join(vdir(), v.model + '.tar.bz2');
    await download(`${MODELS_URL}/${v.model}.tar.bz2`, tgz, (p) => emit('progress', { label: `Voix ${v.label} : ${Math.round(p * 100)} %` }));
    emit('progress', { label: `Voix ${v.label} : installation…` });
    fs.mkdirSync(path.join(vdir(), 'models'), { recursive: true });
    await run('tar', ['-xjf', tgz, '-C', path.join(vdir(), 'models')]);
    fs.rmSync(tgz, { force: true });
    if (!hasModel(v)) throw new Error('Voix introuvable après extraction.');
  }
  fs.rmSync(path.join(vdir(), 'piper'), { recursive: true, force: true }); // ancien moteur (inutilisable) d'une version précédente
  store.settings.set({ voice: { engine: 'piper', piperVoice: v.id } });
  return status();
}

function removeVoice(voiceId) {
  const v = VOICES.find((x) => x.id === voiceId); if (!v) return status();
  stopEngines();
  if (!VOICES.some((o) => o.id !== v.id && o.model === v.model && hasModel(o) && store.settings.get().voice.piperVoice === o.id)) fs.rmSync(modelDir(v), { recursive: true, force: true });
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
    const out = path.join(os.tmpdir(), `jarvis-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`);
    const done = new Promise((resolve, reject) => { e.waiters.push({ resolve, reject }); });
    e.proc.stdin.write(`${rate}\t${out}\t${clean}\n`);
    const timer = setTimeout(() => { try { e.proc.kill(); } catch { /* ok */ } }, 60000);
    try { await done; return fs.readFileSync(out).toString('base64'); } finally { clearTimeout(timer); fs.rmSync(out, { force: true }); }
  });
  e.queue = job.catch(() => {});
  return job;
}

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

function transcribeMacos(buf, lang) {
  const f = path.join(os.tmpdir(), `jarvis-stt-${process.pid}-${Date.now()}.wav`); fs.writeFileSync(f, buf);
  return new Promise((resolve, reject) => {
    execFile(listenBin(), [f, lang === 'nl' ? 'nl-BE' : lang === 'en' ? 'en-GB' : 'fr-FR'], { timeout: 95000 }, (e, so, se) => {
      fs.rmSync(f, { force: true });
      if (e) { const m = String(se || e.message); if (/AUTORISATION_REFUSEE/.test(m)) return reject(new Error('Reconnaissance vocale refusée : autorise Jarvis Parlement dans Réglages Système › Confidentialité › Reconnaissance vocale.')); return reject(new Error(m.replace(/^\w+ : /, '').trim().slice(0, 200) || 'Reconnaissance vocale impossible.')); }
      resolve({ text: String(so).trim() });
    });
  });
}

async function transcribe({ audio, mime }) {
  const v = store.settings.get().voice; const st = store.settings.get();
  const eng = engine();
  if (!eng) throw new Error("Aucune reconnaissance vocale disponible (Réglages › Voix). En attendant, utilise la dictée macOS : appuie deux fois sur Fn.");
  const buf = Buffer.from(audio, 'base64');
  if (buf.length < 1500) throw new Error('Enregistrement trop court.');
  if (eng === 'macos') return transcribeMacos(buf, st.profile.langue);
  const ext = /wav/.test(mime) ? 'wav' : /mp4|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime || 'audio/webm' }), `voix.${ext}`);
  form.append('model', v.sttModel || 'whisper-1'); form.append('language', st.profile.langue || 'fr'); form.append('response_format', 'json');
  const key = store.getSecret('stt_key'); let res;
  try { res = await fetch(v.sttUrl.replace(/\/$/, '') + '/audio/transcriptions', { method: 'POST', headers: key ? { authorization: 'Bearer ' + key } : {}, body: form }); }
  catch (e) { throw new Error('Serveur de transcription injoignable : ' + (e.cause?.code || e.message)); }
  const txt = await res.text(); let j = null; try { j = JSON.parse(txt); } catch { /* brut */ }
  if (!res.ok) throw new Error(`Transcription refusée (${res.status}) : ${j?.error?.message || txt.slice(0, 200)}`);
  return { text: (j?.text ?? txt).trim() };
}

module.exports = { VOICES, piperReady, status, install, removeVoice, synth, stopEngines, configured, engine, macosReady, transcribe };
